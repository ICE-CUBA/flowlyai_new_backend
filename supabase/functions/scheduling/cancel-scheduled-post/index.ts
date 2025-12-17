// supabase/functions/scheduling/cancel-scheduled-post/index.ts
// Cancels a scheduled post and all its targets

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { corsHeaders } from "../../common/_shared/cors.ts";
import { getSupabaseAdmin } from "../../common/_shared/supabaseAdmin.ts";
import { getUserId, AuthError } from "../../common/_shared/auth.ts";
import { validateBody, ValidationError } from "../../common/_shared/validate.ts";
import { logger } from "../../common/_shared/logger.ts";
import {
  CancelScheduledPostRequestSchema,
  DbScheduledPost,
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
    // Only allow PATCH
    if (req.method !== "PATCH") {
      return new Response(
        JSON.stringify(errorResponse("Method not allowed", "METHOD_NOT_ALLOWED")),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    log.info("Cancelling scheduled post");

    // Authenticate user
    const userId = await getUserId(req);
    log.debug("User authenticated", { userId });

    // Validate request body
    const body = await validateBody(req, CancelScheduledPostRequestSchema);
    log.debug("Request validated", { postId: body.postId });

    const supabase = getSupabaseAdmin();

    // Fetch the post to verify ownership and status
    const { data: post, error: fetchError } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("id", body.postId)
      .single();

    if (fetchError || !post) {
      return new Response(
        JSON.stringify(errorResponse("Post not found", "NOT_FOUND")),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const scheduledPost = post as DbScheduledPost;

    // Verify ownership
    if (scheduledPost.user_id !== userId) {
      return new Response(
        JSON.stringify(errorResponse("Forbidden", "FORBIDDEN")),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if post can be cancelled
    const nonCancellableStatuses = ["published", "cancelled"];
    if (nonCancellableStatuses.includes(scheduledPost.status)) {
      return new Response(
        JSON.stringify(
          errorResponse(
            `Cannot cancel post with status: ${scheduledPost.status}`,
            "INVALID_STATUS",
            { currentStatus: scheduledPost.status }
          )
        ),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update post status to cancelled
    const { error: updatePostError } = await supabase
      .from("scheduled_posts")
      .update({
        status: "cancelled",
        metadata: {
          ...scheduledPost.metadata,
          cancelledAt: new Date().toISOString(),
          cancelledBy: userId,
        },
      })
      .eq("id", body.postId);

    if (updatePostError) {
      log.error("Failed to update post status", { error: updatePostError.message });
      throw updatePostError;
    }

    // Update all targets to cancelled (only queued/retrying targets)
    const { data: updatedTargets, error: updateTargetsError } = await supabase
      .from("scheduled_post_targets")
      .update({
        status: "cancelled",
        last_error: "Post cancelled by user",
      })
      .eq("post_id", body.postId)
      .in("status", ["queued", "retrying", "publishing"])
      .select();

    if (updateTargetsError) {
      log.error("Failed to update targets status", { error: updateTargetsError.message });
      throw updateTargetsError;
    }

    log.info("Post cancelled successfully", {
      postId: body.postId,
      targetsUpdated: updatedTargets?.length ?? 0,
    });

    return new Response(
      JSON.stringify(
        successResponse({
          postId: body.postId,
          status: "cancelled",
          targetsUpdated: updatedTargets?.length ?? 0,
        })
      ),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
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

