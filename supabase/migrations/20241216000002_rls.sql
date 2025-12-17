-- ============================================================================
-- Migration: Row Level Security for Scheduler Tables
-- Phase 0: Minimal, Safe, Non-Fragile
-- ============================================================================
--
-- SECURITY MODEL:
-- - Users can only access their own data
-- - scheduled_post_targets access is derived from parent scheduled_posts ownership
-- - DELETE is explicitly not allowed (no policies = denied by default with RLS enabled)
-- - Service role (Edge Functions) bypasses RLS automatically
--
-- ============================================================================

-- ============================================================================
-- 1. ENABLE ROW LEVEL SECURITY
-- ============================================================================
-- When RLS is enabled, all access is denied by default unless a policy allows it.
-- This is the safest default: explicit allow, implicit deny.

ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_post_targets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. POLICIES FOR scheduled_posts
-- ============================================================================
-- Simple ownership check: user_id must match the authenticated user.
-- auth.uid() returns the UUID of the currently authenticated user from the JWT.

-- SELECT: Users can read their own posts
CREATE POLICY "scheduled_posts_select_own"
ON scheduled_posts
FOR SELECT
USING (user_id = auth.uid());

-- INSERT: Users can only insert posts where they are the owner
-- The WITH CHECK ensures the user_id in the new row matches auth.uid()
CREATE POLICY "scheduled_posts_insert_own"
ON scheduled_posts
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- UPDATE: Users can only update their own posts
-- USING: which existing rows can be updated
-- WITH CHECK: what the row must look like after update (prevents changing user_id)
CREATE POLICY "scheduled_posts_update_own"
ON scheduled_posts
FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- DELETE: No policy = denied by default with RLS enabled
-- This is intentional for Phase 0. Add delete policy later if needed.

-- ============================================================================
-- 3. POLICIES FOR scheduled_post_targets
-- ============================================================================
-- Targets don't have user_id directly. Ownership is determined by the parent post.
-- We use EXISTS subquery which is safe and efficient (can use indexes).
--
-- WHY EXISTS instead of JOIN?
-- - RLS policies with JOINs in USING can cause unexpected behavior
-- - EXISTS is a simple boolean check that's well-optimized by Postgres
-- - The subquery is executed once per row being checked

-- SELECT: Users can read targets for posts they own
CREATE POLICY "scheduled_post_targets_select_own"
ON scheduled_post_targets
FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM scheduled_posts 
    WHERE scheduled_posts.id = scheduled_post_targets.post_id
      AND scheduled_posts.user_id = auth.uid()
  )
);

-- INSERT: Users can only insert targets for posts they own
-- This prevents users from attaching targets to other users' posts
CREATE POLICY "scheduled_post_targets_insert_own"
ON scheduled_post_targets
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM scheduled_posts 
    WHERE scheduled_posts.id = scheduled_post_targets.post_id
      AND scheduled_posts.user_id = auth.uid()
  )
);

-- UPDATE: Users can only update targets for posts they own
CREATE POLICY "scheduled_post_targets_update_own"
ON scheduled_post_targets
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 
    FROM scheduled_posts 
    WHERE scheduled_posts.id = scheduled_post_targets.post_id
      AND scheduled_posts.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM scheduled_posts 
    WHERE scheduled_posts.id = scheduled_post_targets.post_id
      AND scheduled_posts.user_id = auth.uid()
  )
);

-- DELETE: No policy = denied by default with RLS enabled

-- ============================================================================
-- 4. GRANT PERMISSIONS TO AUTHENTICATED ROLE
-- ============================================================================
-- RLS policies define WHO can access WHICH rows.
-- GRANT defines WHAT operations are allowed at all.
-- Both are required for access.

GRANT SELECT, INSERT, UPDATE ON scheduled_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON scheduled_post_targets TO authenticated;

-- ============================================================================
-- NOTES FOR FUTURE PHASES
-- ============================================================================
--
-- Phase 1: Add DELETE policies if soft-delete or hard-delete is needed
-- Phase 2: Add policies for social_accounts and media_assets tables
-- Phase 3: Consider adding an index on scheduled_posts(id, user_id) if
--          the EXISTS queries in targets policies become slow at scale
--
-- To test policies:
--   SET request.jwt.claim.sub = 'user-uuid-here';
--   SELECT * FROM scheduled_posts;
--
-- ============================================================================
