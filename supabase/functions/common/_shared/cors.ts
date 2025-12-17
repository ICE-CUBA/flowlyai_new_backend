// supabase/functions/common/_shared/cors.ts
// CORS headers for Edge Functions

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

/**
 * Create CORS headers with a specific origin.
 */
export function corsHeadersForOrigin(origin: string) {
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": origin,
  };
}

/**
 * Check if origin is allowed.
 */
export function isAllowedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin) || allowedOrigins.includes("*");
}

