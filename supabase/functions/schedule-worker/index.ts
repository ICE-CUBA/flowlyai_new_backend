// supabase/functions/schedule-worker/index.ts
// Cron worker: finds due targets and triggers publish-post
// Configure cron in Supabase Dashboard (not config.toml)

// @ts-nocheck - Deno runtime

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// CONFIG
// ============================================================================

const BATCH_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 3;

// Exponential backoff: 1min, 2min, 4min
function shouldRetry(attemptCount: number, lastAttemptAt: string | null): boolean {
  if (attemptCount >= MAX_RETRY_ATTEMPTS) return false;
  if (!lastAttemptAt) return true;

  const backoffMs = 60000 * Math.pow(2, attemptCount); // 1min * 2^attempts
  const nextAttempt = new Date(lastAttemptAt).getTime() + backoffMs;
  return Date.now() >= nextAttempt;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  try {
    // Verify authorized call (cron or internal)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const internalKey = req.headers.get("X-Internal-Key") ?? "";

    const isAuthorized = authHeader.includes(serviceKey) || internalKey === serviceKey;

    if (!isAuthorized) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    console.log("Schedule worker started");
    const startTime = Date.now();

    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    // 1. Find queued targets where post is due
    const { data: queuedTargets, error: qErr } = await supabase
      .from("scheduled_post_targets")
      .select("id, platform, attempt_count, last_attempt_at, scheduled_posts!inner(id, scheduled_at, status)")
      .eq("status", "queued")
      .eq("scheduled_posts.status", "queued")
      .lte("scheduled_posts.scheduled_at", now)
      .limit(BATCH_SIZE);

    if (qErr) {
      console.error("Query error:", qErr);
      throw qErr;
    }

    // 2. Find retrying targets ready for retry
    const { data: retryTargets, error: rErr } = await supabase
      .from("scheduled_post_targets")
      .select("id, platform, attempt_count, last_attempt_at, scheduled_posts!inner(id, status)")
      .eq("status", "retrying")
      .lt("attempt_count", MAX_RETRY_ATTEMPTS)
      .in("scheduled_posts.status", ["queued", "publishing", "partial"])
      .limit(BATCH_SIZE);

    if (rErr) {
      console.error("Retry query error:", rErr);
      throw rErr;
    }

    // Filter retries by backoff
    const eligibleRetries = (retryTargets ?? []).filter((t) =>
      shouldRetry(t.attempt_count, t.last_attempt_at)
    );

    const allTargets = [...(queuedTargets ?? []), ...eligibleRetries];

    if (allTargets.length === 0) {
      console.log("No targets due");
      return jsonResponse({
        success: true,
        processed: 0,
        message: "No targets due",
      });
    }

    console.log(`Found ${allTargets.length} targets to process`);

    // 3. Update posts to publishing
    const postIds = [...new Set(allTargets.map((t) => t.scheduled_posts.id))];
    await supabase
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .in("id", postIds)
      .eq("status", "queued");

    // 4. Call publish-post for each target
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const publishUrl = `${supabaseUrl}/functions/v1/publish-post`;

    const results: Array<{ targetId: string; platform: string; success: boolean; error?: string }> = [];

    for (const target of allTargets) {
      try {
        const res = await fetch(publishUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "X-Internal-Key": serviceKey,
          },
          body: JSON.stringify({ targetId: target.id }),
        });

        const json = await res.json();
        results.push({
          targetId: target.id,
          platform: target.platform,
          success: res.ok && json.success,
          error: json.error,
        });
      } catch (err) {
        results.push({
          targetId: target.id,
          platform: target.platform,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const duration = Date.now() - startTime;

    console.log(`Completed: ${succeeded} succeeded, ${failed} failed, ${duration}ms`);

    return jsonResponse({
      success: true,
      processed: results.length,
      succeeded,
      failed,
      durationMs: duration,
      results,
    });
  } catch (err) {
    console.error("Worker error:", err);
    return jsonResponse({ success: false, error: "Worker failed" }, 500);
  }
});
