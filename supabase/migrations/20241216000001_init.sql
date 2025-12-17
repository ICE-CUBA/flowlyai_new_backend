-- Migration: 0001_init.sql
-- Description: Initial schema for scheduling and social accounts
-- Created: 2024-12-16

-- Enable required extensions (in extensions schema)
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- ============================================================================
-- ENUM Types
-- ============================================================================

CREATE TYPE platform_type AS ENUM (
    'twitter',
    'linkedin',
    'instagram',
    'facebook',
    'threads',
    'tiktok',
    'youtube'
);

CREATE TYPE post_status AS ENUM (
    'draft',
    'queued',
    'publishing',
    'published',
    'partial',
    'failed',
    'cancelled'
);

CREATE TYPE target_status AS ENUM (
    'queued',
    'publishing',
    'sent',
    'failed',
    'retrying',
    'cancelled'
);

-- ============================================================================
-- social_accounts
-- Stores OAuth tokens and metadata for connected social platforms
-- ============================================================================

CREATE TABLE social_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    platform platform_type NOT NULL,
    
    -- OAuth tokens (encrypted at rest via Supabase Vault recommended)
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    
    -- OAuth scopes granted
    scopes TEXT[] DEFAULT '{}',
    
    -- Platform-specific user info
    platform_user_id TEXT NOT NULL,
    platform_username TEXT,
    platform_display_name TEXT,
    platform_avatar_url TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each user can only have one account per platform
    UNIQUE(user_id, platform)
);

-- Indexes for social_accounts
CREATE INDEX idx_social_accounts_user_id_platform 
    ON social_accounts(user_id, platform);

CREATE INDEX idx_social_accounts_expires_at 
    ON social_accounts(expires_at) 
    WHERE expires_at IS NOT NULL;

-- ============================================================================
-- scheduled_posts
-- Main table for scheduled content
-- ============================================================================

CREATE TABLE scheduled_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Content
    content_raw TEXT NOT NULL CHECK (char_length(content_raw) > 0),
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    
    -- Status
    status post_status NOT NULL DEFAULT 'draft',
    
    -- Media references (array of media_asset IDs or manifest object)
    media_manifest JSONB DEFAULT '[]',
    
    -- Optional metadata (hashtags, mentions, link preview, variants, etc.)
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);

-- Indexes for scheduled_posts
CREATE INDEX idx_scheduled_posts_user_id_scheduled_at_status 
    ON scheduled_posts(user_id, scheduled_at, status);

CREATE INDEX idx_scheduled_posts_status_scheduled_at 
    ON scheduled_posts(status, scheduled_at) 
    WHERE status IN ('queued', 'publishing');

CREATE INDEX idx_scheduled_posts_user_id 
    ON scheduled_posts(user_id);

-- ============================================================================
-- scheduled_post_targets
-- Per-platform delivery targets for each scheduled post
-- ============================================================================

CREATE TABLE scheduled_post_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
    platform platform_type NOT NULL,
    
    -- Platform-specific content (may differ from raw due to length limits, formatting)
    content_final TEXT NOT NULL,
    
    -- Delivery status
    status target_status NOT NULL DEFAULT 'queued',
    
    -- Retry tracking
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,
    
    -- Result data
    platform_post_id TEXT,
    platform_post_url TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    
    -- Each post can only target each platform once
    UNIQUE(post_id, platform)
);

-- Indexes for scheduled_post_targets
CREATE INDEX idx_scheduled_post_targets_post_id_platform_status 
    ON scheduled_post_targets(post_id, platform, status);

CREATE INDEX idx_scheduled_post_targets_status 
    ON scheduled_post_targets(status) 
    WHERE status IN ('queued', 'publishing', 'retrying');

CREATE INDEX idx_scheduled_post_targets_post_id 
    ON scheduled_post_targets(post_id);

-- Index for worker query: finding due targets
CREATE INDEX idx_scheduled_post_targets_worker 
    ON scheduled_post_targets(status, attempt_count)
    WHERE status IN ('queued', 'retrying');

-- ============================================================================
-- media_assets
-- Stores uploaded media files and their processed variants
-- ============================================================================

CREATE TABLE media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Original file info
    original_url TEXT NOT NULL,
    original_filename TEXT,
    
    -- Processed variants for different platforms
    -- Example: { "twitter": { "url": "...", "width": 1200, "height": 675 }, ... }
    processed_variants JSONB DEFAULT '{}',
    
    -- File metadata
    mime_type TEXT NOT NULL,
    file_size_bytes BIGINT,
    
    -- Media dimensions (for images/video)
    width INTEGER,
    height INTEGER,
    
    -- Duration in seconds (for video/audio)
    duration NUMERIC(10, 3),
    
    -- Processing status
    processing_status TEXT DEFAULT 'pending' CHECK (
        processing_status IN ('pending', 'processing', 'completed', 'failed')
    ),
    processing_error TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for media_assets
CREATE INDEX idx_media_assets_user_id_created_at 
    ON media_assets(user_id, created_at DESC);

CREATE INDEX idx_media_assets_user_id 
    ON media_assets(user_id);

CREATE INDEX idx_media_assets_processing_status 
    ON media_assets(processing_status) 
    WHERE processing_status IN ('pending', 'processing');

-- ============================================================================
-- Trigger: Auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables
CREATE TRIGGER set_updated_at_social_accounts
    BEFORE UPDATE ON social_accounts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_scheduled_posts
    BEFORE UPDATE ON scheduled_posts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_scheduled_post_targets
    BEFORE UPDATE ON scheduled_post_targets
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_updated_at_media_assets
    BEFORE UPDATE ON media_assets
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE social_accounts IS 'OAuth connections to social media platforms';
COMMENT ON TABLE scheduled_posts IS 'User-created posts scheduled for future publishing';
COMMENT ON TABLE scheduled_post_targets IS 'Per-platform delivery targets for scheduled posts';
COMMENT ON TABLE media_assets IS 'Uploaded media files with processed variants for different platforms';

COMMENT ON COLUMN scheduled_posts.content_raw IS 'Original content before platform-specific formatting';
COMMENT ON COLUMN scheduled_posts.media_manifest IS 'Array of media_asset IDs or structured manifest object';
COMMENT ON COLUMN scheduled_posts.metadata IS 'Extra data including platform variants: { variants: { twitter: "...", linkedin: "..." } }';
COMMENT ON COLUMN scheduled_post_targets.content_final IS 'Platform-optimized content (may differ from raw)';
COMMENT ON COLUMN scheduled_post_targets.attempt_count IS 'Number of publish attempts (max 3 with exponential backoff)';
COMMENT ON COLUMN media_assets.processed_variants IS 'Platform-specific processed versions of the media';
