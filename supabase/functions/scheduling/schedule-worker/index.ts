// supabase/functions/scheduling/schedule-worker/index.ts
// Cron worker that finds due targets and triggers publishing
//
// Configure in supabase/config.toml:
// [functions.schedule-worker]
// schedule = "*/1 * * * *"

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getSupabaseAdmin } from "../../common/_shared/supabaseAdmin.ts";
import { logger } from "../../common/_shared/logger.ts";
import {
  DbScheduledPostTarget,
  MAX_RETRY_ATTEMPTS,
  shouldRetryTarget,
  errorResponse,
  successResponse,
} from "../../common/_shared/types.ts";

const BATCH_SIZE = 50; // Process up to 50 targets per invocation

interface TargetWithPost extends DbScheduledPostTarget {
  scheduled_posts: {
    id: string;
    scheduled_at: string;
    status: string;
  };
}

serve(async (req: Request) => {
  const requestId = logger.generateRequestId();
  const log = logger.withRequestId(requestId);

  try {
    // Verify this is a cron invocation or authorized internal call
    const authHeader = req.headers.get("Authorization");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isCronInvocation = authHeader?.includes(serviceKey);

    if (!isCronInvocation && req.method !== "POST") {
      const internalKey = req.headers.get("X-Internal-Key");
      if (internalKey !== serviceKey) {
        return new Response(
          JSON.stringify(errorResponse("Unauthorized", "UNAUTHORIZED")),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    log.info("Schedule worker started");
    const timer = log.time("schedule-worker-run");

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // Find queued targets where the parent post is due
    const { data: queuedTargets, error: queuedError } = await supabase
      .from("scheduled_post_targets")
      .select(`
        *,
        scheduled_posts!inner (
          id,
          scheduled_at,
          status
        )
      `)
      .eq("status", "queued")
      .eq("scheduled_posts.status", "queued")
      .lte("scheduled_posts.scheduled_at", now)
      .order("scheduled_posts(scheduled_at)", { ascending: true })
      .limit(BATCH_SIZE);

    if (queuedError) {
      log.error("Failed to query queued targets", { error: queuedError.message });
      throw queuedError;
    }

    // Find retrying targets that are ready for retry (respecting backoff)
    const { data: retryingTargets, error: retryingError } = await supabase
      .from("scheduled_post_targets")
      .select(`
        *,
        scheduled_posts!inner (
          id,
          scheduled_at,
          status
        )
      `)
      .eq("status", "retrying")
      .lt("attempt_count", MAX_RETRY_ATTEMPTS)
      .in("scheduled_posts.status", ["queued", "publishing", "partial"])
      .limit(BATCH_SIZE);

    if (retryingError) {
      log.error("Failed to query retrying targets", { error: retryingError.message });
      throw retryingError;
    }

    // Filter retrying targets based on backoff timing
    const eligibleRetries = (retryingTargets as TargetWithPost[] ?? []).filter(
      (target) => shouldRetryTarget(target.attempt_count, target.last_attempt_at)
    );

    // Combine queued and eligible retry targets
    const allTargets = [
      ...(queuedTargets as TargetWithPost[] ?? []),
      ...eligibleRetries,
    ];

    if (allTargets.length === 0) {
      log.info("No targets due for publishing");
      timer();
      return new Response(
        JSON.stringify(successResponse({
          processed: 0,
          queued: 0,
          retries: 0,
          message: "No targets due",
        })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    log.info("Found targets to process", {
      total: allTargets.length,
      queued: queuedTargets?.length ?? 0,
      retries: eligibleRetries.length,
    });

    // Update parent posts to 'publishing' status
    const uniquePostIds = [...new Set(allTargets.map((t) => t.scheduled_posts.id))];
    await supabase
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .in("id", uniquePostIds)
      .eq("status", "queued");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishUrl = `${supabaseUrl}/functions/v1/scheduling/publish-post`;

    const results: Array<{
      targetId: string;
      platform: string;
      success: boolean;
      error?: string;
    }> = [];

    // Process each target
    for (const target of allTargets) {
      try {
        log.debug("Processing target", {
          targetId: target.id,
          platform: target.platform,
          attemptCount: target.attempt_count,
        });

        const response = await fetch(publishUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "X-Internal-Key": serviceKey,
          },
          body: JSON.stringify({ targetId: target.id }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          results.push({
            targetId: target.id,
            platform: target.platform,
            success: true,
          });
          log.info("Target processed successfully", {
            targetId: target.id,
            platform: target.platform,
            status: result.data?.status,
          });
        } else {
          results.push({
            targetId: target.id,
            platform: target.platform,
            success: false,
            error: result.error?.message ?? "Unknown error",
          });
          log.warn("Target processing failed", {
            targetId: target.id,
            platform: target.platform,
            error: result.error?.message,
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        results.push({
          targetId: target.id,
          platform: target.platform,
          success: false,
          error: errorMessage,
        });
        log.error("Target processing threw error", {
          targetId: target.id,
          platform: target.platform,
          error: errorMessage,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    timer();
    log.info("Schedule worker completed", {
      processed: results.length,
      succeeded: successCount,
      failed: failureCount,
      postsAffected: uniquePostIds.length,
    });

    return new Response(
      JSON.stringify(
        successResponse({
          processed: results.length,
          succeeded: successCount,
          failed: failureCount,
          postsAffected: uniquePostIds.length,
          results,
        })
      ),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    log.logError(error as Error);

    return new Response(
      JSON.stringify(errorResponse("Worker execution failed", "WORKER_ERROR")),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

