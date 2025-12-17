// supabase/functions/publish-post/index.ts
// Internal function: publishes a single target to its platform
// Called by schedule-worker, NOT directly by frontend

// @ts-nocheck - Deno runtime

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// ============================================================================
// CONFIG
// ============================================================================

const MAX_RETRY_ATTEMPTS = 3;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================================
// VALIDATION
// ============================================================================

const PublishSchema = z.object({
  targetId: z.string().uuid("Invalid target ID"),
});

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
// PLATFORM PUBLISHER STUB
// ============================================================================

async function publishToPlatform(
  platform: string,
  _content: string,
  _accessToken: string
): Promise<{ success: boolean; postId?: string; postUrl?: string; error?: string }> {
  // Simulate API delay
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 300));

  // 10% simulated failure rate
  if (Math.random() < 0.1) {
    return { success: false, error: `${platform} API error: Rate limit exceeded` };
  }

  const fakeId = crypto.randomUUID().slice(0, 12);
  const urls: Record<string, string> = {
    twitter: `https://twitter.com/i/status/${fakeId}`,
    linkedin: `https://linkedin.com/feed/update/${fakeId}`,
    instagram: `https://instagram.com/p/${fakeId}`,
    facebook: `https://facebook.com/${fakeId}`,
    threads: `https://threads.net/t/${fakeId}`,
    tiktok: `https://tiktok.com/@user/video/${fakeId}`,
    youtube: `https://youtube.com/shorts/${fakeId}`,
  };

  return { success: true, postId: fakeId, postUrl: urls[platform] ?? "" };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    // Verify internal call only
    const internalKey = req.headers.get("X-Internal-Key");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (internalKey !== serviceKey) {
      return jsonResponse({ success: false, error: "Unauthorized - internal only" }, 401);
    }

    // Validate input
    let body;
    try {
      body = PublishSchema.parse(await req.json());
    } catch (e) {
      return jsonResponse({ success: false, error: "Invalid targetId" }, 400);
    }

    const supabase = getSupabaseAdmin();

    // Fetch target with post
    const { data: target, error: targetErr } = await supabase
      .from("scheduled_post_targets")
      .select("*, scheduled_posts(id, user_id, status)")
      .eq("id", body.targetId)
      .single();

    if (targetErr || !target) {
      return jsonResponse({ success: false, error: "Target not found" }, 404);
    }

    // Check status
    if (!["queued", "retrying"].includes(target.status)) {
      return jsonResponse({
        success: false,
        error: `Target status is ${target.status}, cannot publish`,
      }, 400);
    }

    if (target.attempt_count >= MAX_RETRY_ATTEMPTS) {
      return jsonResponse({ success: false, error: "Max retries exceeded" }, 400);
    }

    // Get social account
    const { data: account } = await supabase
      .from("social_accounts")
      .select("access_token")
      .eq("user_id", target.scheduled_posts.user_id)
      .eq("platform", target.platform)
      .single();

    if (!account) {
      await supabase
        .from("scheduled_post_targets")
        .update({
          status: "failed",
          last_error: "No connected account",
          attempt_count: target.attempt_count + 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", body.targetId);

      return jsonResponse({ success: false, error: "No connected account" }, 400);
    }

    // Mark as publishing
    await supabase
      .from("scheduled_post_targets")
      .update({ status: "publishing" })
      .eq("id", body.targetId);

    // Publish
    const result = await publishToPlatform(
      target.platform,
      target.content_final,
      account.access_token
    );

    const now = new Date().toISOString();
    const newAttempt = target.attempt_count + 1;

    if (result.success) {
      await supabase
        .from("scheduled_post_targets")
        .update({
          status: "sent",
          platform_post_id: result.postId,
          platform_post_url: result.postUrl,
          attempt_count: newAttempt,
          last_attempt_at: now,
          published_at: now,
          last_error: null,
        })
        .eq("id", body.targetId);

      await updatePostStatus(supabase, target.scheduled_posts.id);

      return jsonResponse({
        success: true,
        targetId: body.targetId,
        status: "sent",
        platformPostId: result.postId,
        platformPostUrl: result.postUrl,
      });
    } else {
      const newStatus = newAttempt < MAX_RETRY_ATTEMPTS ? "retrying" : "failed";

      await supabase
        .from("scheduled_post_targets")
        .update({
          status: newStatus,
          last_error: result.error,
          attempt_count: newAttempt,
          last_attempt_at: now,
        })
        .eq("id", body.targetId);

      await updatePostStatus(supabase, target.scheduled_posts.id);

      return jsonResponse({
        success: true,
        targetId: body.targetId,
        status: newStatus,
        error: result.error,
        attemptCount: newAttempt,
        willRetry: newStatus === "retrying",
      });
    }
  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});

// ============================================================================
// HELPER: Update parent post status
// ============================================================================

async function updatePostStatus(supabase: ReturnType<typeof getSupabaseAdmin>, postId: string) {
  const { data: targets } = await supabase
    .from("scheduled_post_targets")
    .select("status")
    .eq("post_id", postId);

  if (!targets?.length) return;

  const statuses = targets.map((t) => t.status);
  const hasPending = statuses.some((s) => ["queued", "retrying", "publishing"].includes(s));

  if (hasPending) return;

  const sent = statuses.filter((s) => s === "sent").length;
  const failed = statuses.filter((s) => s === "failed").length;

  let newStatus: string;
  if (sent === statuses.length) newStatus = "published";
  else if (failed === statuses.length) newStatus = "failed";
  else if (sent > 0) newStatus = "partial";
  else newStatus = "failed";

  await supabase
    .from("scheduled_posts")
    .update({ status: newStatus, published_at: sent > 0 ? new Date().toISOString() : null })
    .eq("id", postId);
}
