// supabase/functions/scheduling/create-scheduled-post/index.ts
// ============================================================================
// SINGLE WRITE ENTRY POINT FOR SCHEDULED POSTS
// ============================================================================
//
// WHY THIS EXISTS:
// - Frontend should NOT insert directly into DB tables
// - This function is the ONLY way to create scheduled posts
// - Benefits:
//   1. Centralized validation (can't bypass via direct SQL)
//   2. Atomic transaction (post + targets created together)
//   3. Business logic lives in one place
//   4. Service role bypasses RLS for write, but we validate JWT for auth
//   5. Easier to add audit logging, rate limiting, etc. later
//
// ============================================================================

// @ts-nocheck - Deno runtime

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// ============================================================================
// CORS HEADERS
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================================
// REQUEST VALIDATION SCHEMA
// ============================================================================

const CreatePostSchema = z.object({
  contentRaw: z.string().min(1, "Content cannot be empty"),
  scheduledAt: z.string().datetime("Invalid ISO datetime"),
  timezone: z.string().min(1).default("UTC"),
  platforms: z.array(z.string()).min(1, "At least one platform required"),
  variants: z.record(z.string()).optional(),
});

type CreatePostRequest = z.infer<typeof CreatePostSchema>;

// ============================================================================
// SUPABASE CLIENTS
// ============================================================================

function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    // ========================================================================
    // 1. AUTHENTICATE USER
    // ========================================================================
    const authHeader = req.headers.get("authorization");
    console.log("[AUTH] Checking authorization header...");
    
    if (!authHeader) {
      console.log("[AUTH] ❌ Missing Authorization header");
      return jsonResponse({ success: false, error: "Missing Authorization header" }, 401);
    }
    
    if (!authHeader.startsWith("Bearer ")) {
      console.log("[AUTH] ❌ Invalid Authorization format (expected 'Bearer <token>')");
      return jsonResponse({ success: false, error: "Invalid Authorization format" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    console.log("[AUTH] Token extracted, validating with Supabase...");
    
    // Use admin client to validate token
    const supabaseAdmin = getSupabaseAdmin();
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError) {
      console.log("[AUTH] ❌ Auth error:", authError.message);
      return jsonResponse({ success: false, error: "Invalid or expired token" }, 401);
    }
    
    if (!user) {
      console.log("[AUTH] ❌ User is null (token valid but no user found)");
      return jsonResponse({ success: false, error: "Invalid or expired token" }, 401);
    }
    
    console.log("[AUTH] ✅ User authenticated:", user.id)

    // ========================================================================
    // 2. VALIDATE INPUT
    // ========================================================================
    let body: CreatePostRequest;
    try {
      const rawBody = await req.json();
      body = CreatePostSchema.parse(rawBody);
    } catch (e) {
      const message = e instanceof z.ZodError 
        ? e.errors.map(err => `${err.path.join(".")}: ${err.message}`).join(", ")
        : "Invalid request body";
      return jsonResponse({ success: false, error: message }, 400);
    }

    // Validate scheduledAt is in the future
    const scheduledDate = new Date(body.scheduledAt);
    if (scheduledDate <= new Date()) {
      return jsonResponse({ success: false, error: "scheduledAt must be in the future" }, 400);
    }

    // ========================================================================
    // 3. INSERT scheduled_posts (using service role - reusing admin client)
    // ========================================================================
    const { data: post, error: postError } = await supabaseAdmin
      .from("scheduled_posts")
      .insert({
        user_id: user.id,
        content_raw: body.contentRaw,
        scheduled_at: body.scheduledAt,
        timezone: body.timezone,
        status: "queued",
      })
      .select("id, content_raw, scheduled_at, timezone, status")
      .single();

    if (postError || !post) {
      console.error("Failed to insert scheduled_post:", postError);
      return jsonResponse({ success: false, error: "Failed to create post" }, 500);
    }

    // ========================================================================
    // 4. INSERT scheduled_post_targets (parallel)
    // ========================================================================
    const targetInserts = body.platforms.map((platform) => ({
      post_id: post.id,
      platform,
      content_final: body.variants?.[platform] ?? body.contentRaw,
      status: "queued",
    }));

    const { data: targets, error: targetsError } = await supabaseAdmin
      .from("scheduled_post_targets")
      .insert(targetInserts)
      .select("id, platform, content_final, status");

    if (targetsError) {
      console.error("Failed to insert targets:", targetsError);
      // Rollback: delete the post we just created
      await supabaseAdmin.from("scheduled_posts").delete().eq("id", post.id);
      return jsonResponse({ success: false, error: "Failed to create targets" }, 500);
    }

    // ========================================================================
    // 5. RETURN SUCCESS with full data for frontend
    // ========================================================================
    return jsonResponse({
      post: {
        id: post.id,
        content_raw: post.content_raw,
        scheduled_at: post.scheduled_at,
        timezone: post.timezone,
        status: post.status,
      },
      targets: targets?.map(t => ({
        id: t.id,
        platform: t.platform,
        content_final: t.content_final,
        status: t.status,
      })) ?? [],
    }, 201);

  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse({ success: false, error: "Internal server error" }, 500);
  }
});

// ============================================================================
// HELPER
// ============================================================================

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
