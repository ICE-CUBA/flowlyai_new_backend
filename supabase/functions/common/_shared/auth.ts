// supabase/functions/common/_shared/auth.ts
// Authentication utilities for extracting user info from Supabase JWT

import { getSupabaseAdmin } from "./supabaseAdmin.ts";
import { logger } from "./logger.ts";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

export class AuthError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

/**
 * Extract the JWT token from the Authorization header.
 */
export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  
  if (scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

/**
 * Get the user ID from a Supabase JWT token.
 * Uses Supabase's built-in token verification.
 */
export async function getUserId(request: Request): Promise<string> {
  const token = extractToken(request);

  if (!token) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const supabase = getSupabaseAdmin();
  
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error) {
    logger.warn("Token validation failed", { error: error.message });
    throw new AuthError("Invalid or expired token");
  }

  if (!user) {
    throw new AuthError("User not found");
  }

  return user.id;
}

/**
 * Get full user details from a Supabase JWT token.
 */
export async function getUser(request: Request): Promise<AuthUser> {
  const token = extractToken(request);

  if (!token) {
    throw new AuthError("Missing or invalid Authorization header");
  }

  const supabase = getSupabaseAdmin();
  
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error) {
    logger.warn("Token validation failed", { error: error.message });
    throw new AuthError("Invalid or expired token");
  }

  if (!user) {
    throw new AuthError("User not found");
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role,
  };
}

/**
 * Middleware-style auth check that returns user or throws.
 * Use in function handlers to protect routes.
 */
export async function requireAuth(request: Request): Promise<AuthUser> {
  return await getUser(request);
}
