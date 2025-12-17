// supabase/functions/cancel-scheduled-post/index.ts
// Cancels a scheduled post and all its pending targets

// @ts-nocheck - Deno runtime

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// ============================================================================
// CORS & HELPERS
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
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

const CancelPostSchema = z.object({
  postId: z.string().uuid("Invalid post ID"),
});

// ============================================================================
// SUPABASE CLIENTS
// ============================================================================

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getSupabaseWithAuth(token: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "PATCH") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    // 1. Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Missing authorization token" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await getSupabaseWithAuth(token).auth.getUser();

    if (authError || !user) {
      return jsonResponse({ success: false, error: "Invalid or expired token" }, 401);
    }

    // 2. Validate input
    let body;
    try {
      body = CancelPostSchema.parse(await req.json());
    } catch (e) {
      const msg = e instanceof z.ZodError
        ? e.errors.map(err => `${err.path.join(".")}: ${err.message}`).join(", ")
        : "Invalid request body";
      return jsonResponse({ success: false, error: msg }, 400);
    }

    const supabase = getSupabaseAdmin();

    // 3. Fetch post & verify ownership
    const { data: post, error: fetchError } = await supabase
      .from("scheduled_posts")
      .select("id, user_id, status")
      .eq("id", body.postId)
      .single();

    if (fetchError || !post) {
      return jsonResponse({ success: false, error: "Post not found" }, 404);
    }

    if (post.user_id !== user.id) {
      return jsonResponse({ success: false, error: "Forbidden" }, 403);
    }

    // 4. Check if cancellable
    if (["published", "cancelled"].includes(post.status)) {
      return jsonResponse({
        success: false,
        error: `Cannot cancel post with status: ${post.status}`,
      }, 400);
    }

    // 5. Update post status
    const { error: updatePostError } = await supabase
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .eq("id", body.postId);

    if (updatePostError) {
      console.error("Failed to update post:", updatePostError);
      return jsonResponse({ success: false, error: "Failed to cancel post" }, 500);
    }

    // 6. Update targets to cancelled
    const { data: updatedTargets } = await supabase
      .from("scheduled_post_targets")
      .update({ status: "cancelled", last_error: "Post cancelled by user" })
      .eq("post_id", body.postId)
      .in("status", ["queued", "retrying", "publishing"])
      .select("id");

    // 7. Return success
    return jsonResponse({
      success: true,
      postId: body.postId,
      status: "cancelled",
      targetsUpdated: updatedTargets?.length ?? 0,
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});
