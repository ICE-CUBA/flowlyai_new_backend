#!/bin/bash
# Deploy all Edge Functions to Supabase

set -e

echo "🚀 Deploying Flowly AI Edge Functions..."

# Check if linked
if ! supabase projects list > /dev/null 2>&1; then
    echo "❌ Not logged in. Run: supabase login"
    exit 1
fi

echo ""
echo "📦 Deploying functions..."

echo "  → create-scheduled-post"
supabase functions deploy create-scheduled-post --no-verify-jwt

echo "  → cancel-scheduled-post"
supabase functions deploy cancel-scheduled-post --no-verify-jwt

echo "  → publish-post"
supabase functions deploy publish-post --no-verify-jwt

echo "  → schedule-worker"
supabase functions deploy schedule-worker --no-verify-jwt

echo ""
echo "✅ All functions deployed!"
echo ""
echo "📝 Set secrets (if not already):"
echo "  supabase secrets set SUPABASE_URL=https://your-project.supabase.co"
echo "  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-key"
echo "  supabase secrets set SUPABASE_ANON_KEY=your-anon-key"
echo ""
echo "⏰ Configure cron for schedule-worker in Dashboard:"
echo "  Edge Functions → schedule-worker → Schedule: */1 * * * *"
