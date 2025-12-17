// supabase/functions/scheduling/create-scheduled-post/index.ts
// Creates a scheduled post with platform-specific targets

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../../common/_shared/cors.ts";
import { getSupabaseAdmin } from "../../common/_shared/supabaseAdmin.ts";
import { getUserId, AuthError } from "../../common/_shared/auth.ts";
import { validateBody, ValidationError } from "../../common/_shared/validate.ts";
import { logger } from "../../common/_shared/logger.ts";
import {
  CreateScheduledPostRequestSchema,
  DbScheduledPost,
  DbScheduledPostTarget,
  dbScheduledPostToApi,
  dbScheduledPostTargetToApi,
  successResponse,
  errorResponse,
} from "../../common/_shared/types.ts";

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId = logger.generateRequestId();
  const log = logger.withRequestId(requestId);

  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify(errorResponse("Method not allowed", "METHOD_NOT_ALLOWED")),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    log.info("Creating scheduled post");

    // Authenticate user
    const userId = await getUserId(req);
    log.debug("User authenticated", { userId });

    // Validate request body
    const body = await validateBody(req, CreateScheduledPostRequestSchema);
    log.debug("Request validated", {
      platforms: body.platforms,
      scheduledAt: body.scheduledAt,
      hasVariants: !!body.variants,
    });

    // Validate scheduled time is in the future
    const scheduledAt = new Date(body.scheduledAt);
    const now = new Date();
    if (scheduledAt <= now) {
      return new Response(
        JSON.stringify(
          errorResponse("Scheduled time must be in the future", "INVALID_SCHEDULE_TIME")
        ),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = getSupabaseAdmin();

    // Verify user has connected accounts for requested platforms
    const { data: accounts, error: accountsError } = await supabase
      .from("social_accounts")
      .select("platform")
      .eq("user_id", userId)
      .in("platform", body.platforms);

    if (accountsError) {
      log.error("Failed to check social accounts", { error: accountsError.message });
      throw accountsError;
    }

    const connectedPlatforms = new Set(accounts?.map((a) => a.platform) ?? []);
    const missingPlatforms = body.platforms.filter((p) => !connectedPlatforms.has(p));

    if (missingPlatforms.length > 0) {
      return new Response(
        JSON.stringify(
          errorResponse(
            `Missing social account connections for: ${missingPlatforms.join(", ")}`,
            "MISSING_CONNECTIONS",
            { missingPlatforms }
          )
        ),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Build media manifest from asset IDs
    const mediaManifest = body.mediaAssetIds?.map((id) => ({ assetId: id })) ?? [];

    // Validate media assets belong to user if provided
    if (body.mediaAssetIds && body.mediaAssetIds.length > 0) {
      const { data: assets, error: assetsError } = await supabase
        .from("media_assets")
        .select("id")
        .eq("user_id", userId)
        .in("id", body.mediaAssetIds);

      if (assetsError) {
        log.error("Failed to validate media assets", { error: assetsError.message });
        throw assetsError;
      }

      const foundIds = new Set(assets?.map((a) => a.id) ?? []);
      const missingAssets = body.mediaAssetIds.filter((id) => !foundIds.has(id));

      if (missingAssets.length > 0) {
        return new Response(
          JSON.stringify(
            errorResponse(
              "Some media assets not found or not owned by user",
              "INVALID_MEDIA_ASSETS",
              { missingAssets }
            )
          ),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Insert the scheduled post with status='queued'
    const { data: post, error: postError } = await supabase
      .from("scheduled_posts")
      .insert({
        user_id: userId,
        content_raw: body.contentRaw,
        scheduled_at: body.scheduledAt,
        timezone: body.timezone,
        status: "queued",
        media_manifest: mediaManifest,
        metadata: {
          variants: body.variants ?? {},
        },
      })
      .select()
      .single();

    if (postError) {
      log.error("Failed to insert scheduled post", { error: postError.message });
      throw postError;
    }

    const createdPost = post as DbScheduledPost;
    log.info("Scheduled post created", { postId: createdPost.id });

    // Create platform targets with status='queued'
    // Use variant content if provided, otherwise use contentRaw
    const targetInserts = body.platforms.map((platform) => ({
      post_id: createdPost.id,
      platform,
      content_final: body.variants?.[platform] ?? body.contentRaw,
      status: "queued",
      attempt_count: 0,
    }));

    const { data: targets, error: targetsError } = await supabase
      .from("scheduled_post_targets")
      .insert(targetInserts)
      .select();

    if (targetsError) {
      log.error("Failed to insert post targets", { error: targetsError.message });
      // Rollback: delete the post
      await supabase.from("scheduled_posts").delete().eq("id", createdPost.id);
      throw targetsError;
    }

    log.info("Post targets created", {
      postId: createdPost.id,
      targetCount: targets?.length ?? 0,
      platforms: body.platforms,
    });

    // Build response
    const responsePost = dbScheduledPostToApi(createdPost);
    responsePost.targets = (targets as DbScheduledPostTarget[]).map(dbScheduledPostTargetToApi);

    return new Response(JSON.stringify(successResponse(responsePost)), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    log.logError(error as Error);

    if (error instanceof AuthError) {
      return new Response(
        JSON.stringify(errorResponse(error.message, "UNAUTHORIZED")),
        {
          status: error.statusCode,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (error instanceof ValidationError) {
      return new Response(
        JSON.stringify(errorResponse(error.message, "VALIDATION_ERROR", error.details)),
        {
          status: error.statusCode,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify(errorResponse("Internal server error", "INTERNAL_ERROR")),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

