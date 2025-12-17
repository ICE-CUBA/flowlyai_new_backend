// supabase/functions/scheduling/publish-post/index.ts
// Publishes a single target to its platform

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../../common/_shared/cors.ts";
import { getSupabaseAdmin } from "../../common/_shared/supabaseAdmin.ts";
import { AuthError } from "../../common/_shared/auth.ts";
import { validateBody, ValidationError } from "../../common/_shared/validate.ts";
import { logger } from "../../common/_shared/logger.ts";
import {
  PublishTargetRequestSchema,
  DbScheduledPostTarget,
  DbSocialAccount,
  Platform,
  MAX_RETRY_ATTEMPTS,
  successResponse,
  errorResponse,
} from "../../common/_shared/types.ts";

interface PublishResult {
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

/**
 * Platform publisher stub - simulates publishing to a social platform.
 * Replace with actual platform API integrations.
 */
async function publishToPlatform(
  platform: Platform,
  content: string,
  _accessToken: string,
  _mediaUrls?: string[]
): Promise<PublishResult> {
  // Simulate API call delay (100-500ms)
  await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 400));

  // Simulate occasional failures for testing (10% failure rate)
  if (Math.random() < 0.1) {
    return {
      success: false,
      error: `Simulated ${platform} API error: Rate limit exceeded`,
    };
  }

  // Generate fake post ID and URL
  const fakePostId = crypto.randomUUID().slice(0, 12);
  
  const platformUrls: Record<Platform, string> = {
    twitter: `https://twitter.com/user/status/${fakePostId}`,
    linkedin: `https://linkedin.com/feed/update/${fakePostId}`,
    instagram: `https://instagram.com/p/${fakePostId}`,
    facebook: `https://facebook.com/posts/${fakePostId}`,
    threads: `https://threads.net/t/${fakePostId}`,
    tiktok: `https://tiktok.com/@user/video/${fakePostId}`,
    youtube: `https://youtube.com/shorts/${fakePostId}`,
  };

  return {
    success: true,
    postId: fakePostId,
    postUrl: platformUrls[platform],
  };
}

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

    // Verify internal call (from schedule-worker or authorized service)
    const internalKey = req.headers.get("X-Internal-Key");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (internalKey !== serviceKey) {
      return new Response(
        JSON.stringify(errorResponse("Unauthorized - internal only", "UNAUTHORIZED")),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    log.info("Publishing target");

    // Validate request body
    const body = await validateBody(req, PublishTargetRequestSchema);
    log.debug("Request validated", { targetId: body.targetId });

    const supabase = getSupabaseAdmin();

    // Fetch target with post details
    const { data: target, error: targetError } = await supabase
      .from("scheduled_post_targets")
      .select(`
        *,
        scheduled_posts (
          id,
          user_id,
          content_raw,
          media_manifest,
          status
        )
      `)
      .eq("id", body.targetId)
      .single();

    if (targetError || !target) {
      return new Response(
        JSON.stringify(errorResponse("Target not found", "NOT_FOUND")),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const postTarget = target as DbScheduledPostTarget & {
      scheduled_posts: {
        id: string;
        user_id: string;
        content_raw: string;
        media_manifest: unknown[];
        status: string;
      };
    };

    // Check if target is in a publishable state
    const publishableStatuses = ["queued", "retrying"];
    if (!publishableStatuses.includes(postTarget.status)) {
      return new Response(
        JSON.stringify(
          errorResponse(
            `Target cannot be published with status: ${postTarget.status}`,
            "INVALID_STATUS",
            { currentStatus: postTarget.status }
          )
        ),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check attempt count
    if (postTarget.attempt_count >= MAX_RETRY_ATTEMPTS) {
      return new Response(
        JSON.stringify(
          errorResponse(
            `Max retry attempts (${MAX_RETRY_ATTEMPTS}) exceeded`,
            "MAX_RETRIES_EXCEEDED",
            { attemptCount: postTarget.attempt_count }
          )
        ),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the user's social account for this platform
    const { data: account, error: accountError } = await supabase
      .from("social_accounts")
      .select("*")
      .eq("user_id", postTarget.scheduled_posts.user_id)
      .eq("platform", postTarget.platform)
      .single();

    if (accountError || !account) {
      // Mark as failed - no connected account
      await supabase
        .from("scheduled_post_targets")
        .update({
          status: "failed",
          last_error: "No connected social account for this platform",
          attempt_count: postTarget.attempt_count + 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", body.targetId);

      return new Response(
        JSON.stringify(
          errorResponse(
            "No connected social account for platform",
            "NO_ACCOUNT",
            { platform: postTarget.platform }
          )
        ),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const socialAccount = account as DbSocialAccount;
    log.info("Publishing to platform", {
      targetId: body.targetId,
      platform: postTarget.platform,
      attemptCount: postTarget.attempt_count + 1,
    });

    // Update target to publishing
    await supabase
      .from("scheduled_post_targets")
      .update({ status: "publishing" })
      .eq("id", body.targetId);

    // Call the platform publisher
    const result = await publishToPlatform(
      postTarget.platform,
      postTarget.content_final,
      socialAccount.access_token
    );

    const now = new Date().toISOString();

    if (result.success) {
      // Success - update target
      await supabase
        .from("scheduled_post_targets")
        .update({
          status: "sent",
          platform_post_id: result.postId,
          platform_post_url: result.postUrl,
          attempt_count: postTarget.attempt_count + 1,
          last_attempt_at: now,
          published_at: now,
          last_error: null,
        })
        .eq("id", body.targetId);

      log.info("Target published successfully", {
        targetId: body.targetId,
        platform: postTarget.platform,
        platformPostId: result.postId,
      });

      // Check if all targets for this post are now complete
      await updatePostStatusIfComplete(supabase, postTarget.scheduled_posts.id, log);

      return new Response(
        JSON.stringify(
          successResponse({
            targetId: body.targetId,
            status: "sent",
            platformPostId: result.postId,
            platformPostUrl: result.postUrl,
          })
        ),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } else {
      // Failed - determine if we should retry
      const newAttemptCount = postTarget.attempt_count + 1;
      const shouldRetry = newAttemptCount < MAX_RETRY_ATTEMPTS;
      const newStatus = shouldRetry ? "retrying" : "failed";

      await supabase
        .from("scheduled_post_targets")
        .update({
          status: newStatus,
          last_error: result.error,
          attempt_count: newAttemptCount,
          last_attempt_at: now,
        })
        .eq("id", body.targetId);

      log.warn("Target publish failed", {
        targetId: body.targetId,
        platform: postTarget.platform,
        error: result.error,
        attemptCount: newAttemptCount,
        willRetry: shouldRetry,
      });

      // Update post status if needed
      await updatePostStatusIfComplete(supabase, postTarget.scheduled_posts.id, log);

      return new Response(
        JSON.stringify(
          successResponse({
            targetId: body.targetId,
            status: newStatus,
            error: result.error,
            attemptCount: newAttemptCount,
            willRetry: shouldRetry,
          })
        ),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
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

/**
 * Update the parent post status based on all target statuses.
 */
async function updatePostStatusIfComplete(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  postId: string,
  log: ReturnType<typeof logger.withRequestId>
) {
  const { data: targets } = await supabase
    .from("scheduled_post_targets")
    .select("status")
    .eq("post_id", postId);

  if (!targets || targets.length === 0) return;

  const statuses = targets.map((t) => t.status);
  
  // All sent -> published
  // All failed/cancelled -> failed
  // Mix of sent and failed -> partial
  // Any queued/retrying/publishing -> still publishing
  
  const hasPending = statuses.some((s) => ["queued", "retrying", "publishing"].includes(s));
  if (hasPending) {
    // Still in progress
    return;
  }

  const sentCount = statuses.filter((s) => s === "sent").length;
  const failedCount = statuses.filter((s) => s === "failed").length;

  let newPostStatus: string;
  if (sentCount === statuses.length) {
    newPostStatus = "published";
  } else if (failedCount === statuses.length) {
    newPostStatus = "failed";
  } else if (sentCount > 0) {
    newPostStatus = "partial";
  } else {
    newPostStatus = "failed";
  }

  await supabase
    .from("scheduled_posts")
    .update({
      status: newPostStatus,
      published_at: sentCount > 0 ? new Date().toISOString() : null,
    })
    .eq("id", postId);

  log.info("Post status updated", { postId, status: newPostStatus });
}

