#!/bin/bash
# Start local Supabase development environment

set -e

echo "🏗️  Starting Flowly AI local development..."

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Install with:"
    echo "   brew install supabase/tap/supabase"
    exit 1
fi

# Start Supabase
echo "🐘 Starting Supabase services..."
supabase start

echo ""
echo "✅ Supabase is running!"
echo ""
echo "📝 Copy the credentials above to your .env file"
echo ""
echo "🔧 Next steps:"
echo "  1. Copy .env.example to .env and update with the credentials above"
echo "  2. Run migrations: supabase db push"
echo "  3. Serve functions: supabase functions serve"
echo ""
echo "🌐 Studio UI: http://localhost:54323"

