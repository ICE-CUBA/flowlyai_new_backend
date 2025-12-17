-- Migration: 0002_rls.sql
-- Description: Row Level Security policies for all tables
-- Created: 2024-12-16

-- ============================================================================
-- Enable RLS on all tables
-- ============================================================================

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_post_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- social_accounts policies
-- Users can only access their own social accounts
-- ============================================================================

CREATE POLICY "social_accounts_select_own"
    ON social_accounts
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "social_accounts_insert_own"
    ON social_accounts
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "social_accounts_update_own"
    ON social_accounts
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "social_accounts_delete_own"
    ON social_accounts
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- scheduled_posts policies
-- Users can only access their own scheduled posts
-- ============================================================================

CREATE POLICY "scheduled_posts_select_own"
    ON scheduled_posts
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "scheduled_posts_insert_own"
    ON scheduled_posts
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "scheduled_posts_update_own"
    ON scheduled_posts
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "scheduled_posts_delete_own"
    ON scheduled_posts
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- scheduled_post_targets policies
-- Users can access targets via join through scheduled_posts.user_id
-- ============================================================================

CREATE POLICY "scheduled_post_targets_select_own"
    ON scheduled_post_targets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM scheduled_posts sp
            WHERE sp.id = scheduled_post_targets.post_id
            AND sp.user_id = auth.uid()
        )
    );

CREATE POLICY "scheduled_post_targets_insert_own"
    ON scheduled_post_targets
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scheduled_posts sp
            WHERE sp.id = scheduled_post_targets.post_id
            AND sp.user_id = auth.uid()
        )
    );

CREATE POLICY "scheduled_post_targets_update_own"
    ON scheduled_post_targets
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM scheduled_posts sp
            WHERE sp.id = scheduled_post_targets.post_id
            AND sp.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM scheduled_posts sp
            WHERE sp.id = scheduled_post_targets.post_id
            AND sp.user_id = auth.uid()
        )
    );

CREATE POLICY "scheduled_post_targets_delete_own"
    ON scheduled_post_targets
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM scheduled_posts sp
            WHERE sp.id = scheduled_post_targets.post_id
            AND sp.user_id = auth.uid()
        )
    );

-- ============================================================================
-- media_assets policies
-- Users can only access their own media assets
-- ============================================================================

CREATE POLICY "media_assets_select_own"
    ON media_assets
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "media_assets_insert_own"
    ON media_assets
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "media_assets_update_own"
    ON media_assets
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "media_assets_delete_own"
    ON media_assets
    FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- Service role bypass note
-- ============================================================================
-- The service_role key bypasses RLS by default in Supabase.
-- Edge Functions using SUPABASE_SERVICE_ROLE_KEY will have full access
-- for operations like the schedule-worker cron job.

-- ============================================================================
-- Grant permissions to authenticated users
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON social_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_post_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_assets TO authenticated;

-- Grant usage on sequences (if any auto-increment columns exist)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

