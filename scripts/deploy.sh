#!/bin/bash
# Deploy all Edge Functions to Supabase

set -e

echo "🚀 Deploying Flowly AI Edge Functions..."

# Check if linked to a project
if ! supabase projects list > /dev/null 2>&1; then
    echo "❌ Error: Not logged in to Supabase CLI"
    echo "Run: supabase login"
    exit 1
fi

# Deploy scheduling functions
echo ""
echo "📦 Deploying scheduling functions..."

echo "  → create-scheduled-post"
supabase functions deploy scheduling/create-scheduled-post --no-verify-jwt

echo "  → cancel-scheduled-post"
supabase functions deploy scheduling/cancel-scheduled-post --no-verify-jwt

echo "  → publish-post"
supabase functions deploy scheduling/publish-post --no-verify-jwt

echo "  → schedule-worker"
supabase functions deploy scheduling/schedule-worker --no-verify-jwt

echo ""
echo "✅ All functions deployed successfully!"
echo ""
echo "📝 Set required secrets:"
echo "  supabase secrets set SUPABASE_URL=https://your-project.supabase.co"
echo "  supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key"
echo "  supabase secrets set SUPABASE_ANON_KEY=your-anon-key"
echo ""
echo "⏰ Configure cron schedule for schedule-worker in Supabase Dashboard:"
echo "  Schedule: */1 * * * * (every minute)"

