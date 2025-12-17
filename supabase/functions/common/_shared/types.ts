// supabase/functions/common/_shared/types.ts
// Database and request types for Edge Functions

import { z } from "./validate.ts";

// ============================================================================
// Platform Types
// ============================================================================

export const PlatformSchema = z.enum([
  "twitter",
  "linkedin",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
]);

export type Platform = z.infer<typeof PlatformSchema>;

// ============================================================================
// Status Types
// ============================================================================

export const PostStatusSchema = z.enum([
  "draft",
  "queued",
  "publishing",
  "published",
  "partial",
  "failed",
  "cancelled",
]);

export type PostStatus = z.infer<typeof PostStatusSchema>;

export const TargetStatusSchema = z.enum([
  "queued",
  "publishing",
  "sent",
  "failed",
  "retrying",
  "cancelled",
]);

export type TargetStatus = z.infer<typeof TargetStatusSchema>;

// ============================================================================
// Database Row Types (snake_case matching Supabase tables)
// ============================================================================

export interface DbSocialAccount {
  id: string;
  user_id: string;
  platform: Platform;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
  platform_user_id: string;
  platform_username: string | null;
  platform_display_name: string | null;
  platform_avatar_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbScheduledPost {
  id: string;
  user_id: string;
  content_raw: string;
  scheduled_at: string;
  timezone: string;
  status: PostStatus;
  media_manifest: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface DbScheduledPostTarget {
  id: string;
  post_id: string;
  platform: Platform;
  content_final: string;
  status: TargetStatus;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: string | null;
  platform_post_id: string | null;
  platform_post_url: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface DbMediaAsset {
  id: string;
  user_id: string;
  original_url: string;
  original_filename: string | null;
  processed_variants: Record<string, unknown>;
  mime_type: string;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  processing_status: "pending" | "processing" | "completed" | "failed";
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API Types (camelCase for frontend)
// ============================================================================

export interface SocialAccount {
  id: string;
  userId: string;
  platform: Platform;
  expiresAt: string | null;
  scopes: string[];
  platformUserId: string;
  platformUsername: string | null;
  platformDisplayName: string | null;
  platformAvatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledPost {
  id: string;
  userId: string;
  contentRaw: string;
  scheduledAt: string;
  timezone: string;
  status: PostStatus;
  mediaManifest: unknown[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  targets?: ScheduledPostTarget[];
}

export interface ScheduledPostTarget {
  id: string;
  postId: string;
  platform: Platform;
  contentFinal: string;
  status: TargetStatus;
  attemptCount: number;
  lastError: string | null;
  platformPostId: string | null;
  platformPostUrl: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface MediaAsset {
  id: string;
  userId: string;
  originalUrl: string;
  originalFilename: string | null;
  processedVariants: Record<string, unknown>;
  mimeType: string;
  fileSizeBytes: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  processingStatus: string;
  createdAt: string;
}

// ============================================================================
// Request Schemas
// ============================================================================

export const CreateScheduledPostRequestSchema = z.object({
  contentRaw: z.string().min(1).max(50000),
  platforms: z.array(PlatformSchema).min(1),
  scheduledAt: z.string().datetime(),
  timezone: z.string().default("UTC"),
  mediaAssetIds: z.array(z.string().uuid()).optional(),
  variants: z.record(z.string()).optional(), // platform -> content override
});

export type CreateScheduledPostRequest = z.infer<typeof CreateScheduledPostRequestSchema>;

export const CancelScheduledPostRequestSchema = z.object({
  postId: z.string().uuid(),
});

export type CancelScheduledPostRequest = z.infer<typeof CancelScheduledPostRequestSchema>;

export const PublishTargetRequestSchema = z.object({
  targetId: z.string().uuid(),
});

export type PublishTargetRequest = z.infer<typeof PublishTargetRequestSchema>;

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export function successResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function errorResponse(
  message: string,
  code?: string,
  details?: unknown
): ApiResponse {
  return {
    success: false,
    error: { message, code, details },
  };
}

// ============================================================================
// Conversion Functions (DB → API)
// ============================================================================

export function dbSocialAccountToApi(row: DbSocialAccount): SocialAccount {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    expiresAt: row.expires_at,
    scopes: row.scopes,
    platformUserId: row.platform_user_id,
    platformUsername: row.platform_username,
    platformDisplayName: row.platform_display_name,
    platformAvatarUrl: row.platform_avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function dbScheduledPostToApi(row: DbScheduledPost): ScheduledPost {
  return {
    id: row.id,
    userId: row.user_id,
    contentRaw: row.content_raw,
    scheduledAt: row.scheduled_at,
    timezone: row.timezone,
    status: row.status,
    mediaManifest: row.media_manifest,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

export function dbScheduledPostTargetToApi(row: DbScheduledPostTarget): ScheduledPostTarget {
  return {
    id: row.id,
    postId: row.post_id,
    platform: row.platform,
    contentFinal: row.content_final,
    status: row.status,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    platformPostId: row.platform_post_id,
    platformPostUrl: row.platform_post_url,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export function dbMediaAssetToApi(row: DbMediaAsset): MediaAsset {
  return {
    id: row.id,
    userId: row.user_id,
    originalUrl: row.original_url,
    originalFilename: row.original_filename,
    processedVariants: row.processed_variants,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    width: row.width,
    height: row.height,
    duration: row.duration,
    processingStatus: row.processing_status,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Retry / Backoff Utilities
// ============================================================================

export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Calculate exponential backoff delay in milliseconds.
 * Base delay: 60 seconds, multiplied by 2^attemptCount
 */
export function getBackoffDelayMs(attemptCount: number): number {
  const baseDelayMs = 60 * 1000; // 1 minute
  return baseDelayMs * Math.pow(2, attemptCount);
}

/**
 * Check if a target should be retried based on attempt count and last attempt time.
 */
export function shouldRetryTarget(
  attemptCount: number,
  lastAttemptAt: string | null
): boolean {
  if (attemptCount >= MAX_RETRY_ATTEMPTS) {
    return false;
  }

  if (!lastAttemptAt) {
    return true;
  }

  const backoffMs = getBackoffDelayMs(attemptCount);
  const nextAttemptTime = new Date(lastAttemptAt).getTime() + backoffMs;
  return Date.now() >= nextAttemptTime;
}

