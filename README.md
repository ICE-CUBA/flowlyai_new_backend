# Flowly AI - Supabase Backend

A serverless backend for Flowly AI using Supabase Edge Functions and PostgreSQL.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (v1.100.0+)
- [Deno](https://deno.land/) (for local development and testing)

## Getting Started

### 1. Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# npm (alternative)
npm install -g supabase
```

### 2. Clone and Setup

```bash
cd flowlyai-supabase-backend
cp .env.example .env
```

### 3. Start Local Supabase

```bash
# Initialize (first time only)
supabase init

# Start local development stack
supabase start

# This will output your local credentials:
# - API URL: http://localhost:54321
# - anon key: eyJh...
# - service_role key: eyJh...
```

Update your `.env` with the output credentials.

### 4. Run Migrations

```bash
supabase db push
```

### 5. Serve Edge Functions Locally

```bash
# Serve all functions
supabase functions serve

# Serve a specific function
supabase functions serve scheduling/create-scheduled-post
```

## Project Structure

```
flowlyai-supabase-backend/
├── supabase/
│   ├── functions/
│   │   ├── common/
│   │   │   └── _shared/          # Shared modules (not deployed as functions)
│   │   │       ├── supabaseAdmin.ts
│   │   │       ├── auth.ts
│   │   │       ├── validate.ts
│   │   │       ├── logger.ts
│   │   │       └── types.ts
│   │   ├── oauth/                # OAuth flow handlers
│   │   ├── scheduling/           # Post scheduling functions
│   │   │   ├── create-scheduled-post/
│   │   │   ├── publish-post/
│   │   │   └── schedule-worker/
│   │   └── media/                # Media upload/processing
│   └── migrations/               # Database migrations
├── scripts/                      # Utility scripts
├── .env.example
└── README.md
```

## Edge Functions

### Scheduling Functions

| Function | Method | Description |
|----------|--------|-------------|
| `scheduling/create-scheduled-post` | POST | Create a new scheduled post |
| `scheduling/publish-post` | POST | Publish a scheduled post to platforms |
| `scheduling/schedule-worker` | CRON | Worker that triggers due posts |

### Example: Create Scheduled Post

```bash
curl -X POST http://localhost:54321/functions/v1/scheduling/create-scheduled-post \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello World!",
    "platforms": ["twitter", "linkedin"],
    "scheduledAt": "2024-12-20T10:00:00Z"
  }'
```

## Deploying to Production

### Link to Remote Project

```bash
supabase link --project-ref your-project-ref
```

### Deploy Functions

```bash
# Deploy all functions
supabase functions deploy

# Deploy specific function
supabase functions deploy scheduling/create-scheduled-post
```

### Deploy Migrations

```bash
supabase db push
```

## Development Tips

### Testing Functions Locally

```bash
# With JWT token from your Supabase auth
curl -X POST http://localhost:54321/functions/v1/scheduling/create-scheduled-post \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test post"}'
```

### Viewing Logs

```bash
# Local logs appear in terminal running `supabase functions serve`

# Production logs
supabase functions logs scheduling/create-scheduled-post
```

### Adding New Functions

```bash
# Create new function
supabase functions new my-new-function

# Or manually create folder structure:
mkdir -p supabase/functions/my-new-function
touch supabase/functions/my-new-function/index.ts
```

## Environment Variables

Edge Functions can access environment variables set via:

```bash
# Set secret for deployed functions
supabase secrets set MY_SECRET=value

# List secrets
supabase secrets list
```

## License

MIT
