# Setup Guide

## Prerequisites

- Node.js 20+
- A Supabase project (free tier works)
- An Upstash Redis database (for rate limiting)
- An Inngest account (for background jobs)
- A Google Cloud project (for Gmail OAuth — optional)
- A Gemini/OpenAI API key (for AI features — optional)

## 1. Clone and Install

```bash
git clone <your-repo-url> flowrish-next
cd flowrish-next
npm install
```

## 2. Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase pooled connection string (Transaction mode) |
| `DIRECT_URL` | Supabase direct connection string (for migrations) |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `INNGEST_EVENT_KEY` | Inngest event key |
| `INNGEST_SIGNING_KEY` | Inngest signing key (set as env var, auto-read by SDK) |
| `EMAIL_ENCRYPTION_KEY` | 32-byte hex string for OAuth token encryption |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_API_URL` | Gemini/OpenAI API endpoint | — |
| `AI_API_KEY` | API key for AI service | — |
| `AI_MODEL` | Model name (e.g. `gemini-2.5-flash`) | — |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Gmail) | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |

### Generating EMAIL_ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Database Setup

### Run Migrations

```bash
npx prisma migrate deploy
```

### Generate Prisma Client

```bash
npx prisma generate
```

### Seed Default Data

```bash
npx prisma db seed
```

This creates default roles (OWNER, ADMIN, MANAGER, MEMBER) with their permissions.

## 4. Supabase Auth Configuration

In your Supabase dashboard:

1. **Authentication → Providers → Email**: Enable email auth (magic links)
2. **Authentication → Providers → Google**: Enable and add your OAuth credentials
3. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (dev) or your production URL
   - Redirect URLs: Add `http://localhost:3000/auth/callback`

## 5. Inngest Setup

1. Sign up at [inngest.com](https://www.inngest.com)
2. Create an app, get your Event Key and Signing Key
3. For local development, run the Inngest Dev Server:

```bash
npx inngest-cli@latest dev
```

The dev server connects to your app at `http://localhost:3000/api/inngest`.

## 6. Running Locally

```bash
npm run dev
```

Visit `http://localhost:3000`. You'll be redirected to the login page.

## 7. Running Tests

```bash
# Run all tests once
npm run test

# Watch mode
npm run test:watch
```

The test suite includes 836 tests covering:
- Unit tests for all services
- Property-based tests (fast-check) for invariants
- Component tests (Testing Library)

## 8. Production Deployment (Vercel)

1. Push to GitHub
2. Import the repo in Vercel
3. Set all environment variables in Vercel's dashboard
4. Vercel auto-detects Next.js and deploys

The `vercel.json` configures the build command to run `prisma generate` before `next build`.

### CI/CD

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push:
- TypeScript strict check (`tsc --noEmit`)
- Full test suite (`vitest --run`)

## 9. Supabase Migrations in Production

Before deploying schema changes:

```bash
# Create a new migration
npx prisma migrate dev --name your_migration_name

# Deploy to production
npx prisma migrate deploy
```

Or use the Supabase CLI for direct SQL migrations if needed.
