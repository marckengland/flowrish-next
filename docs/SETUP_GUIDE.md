# Setup Guide

## Prerequisites

- Node.js 20+
- A Supabase project (free tier works)
- An Upstash Redis database (for rate limiting)
- An Inngest account (for background jobs)
- A Google Cloud project (for Google OAuth login + Gmail integration)
- A Gemini/OpenAI API key (for AI features — optional)

## 1. Clone and Install

```bash
git clone <your-repo-url> flowrish-next
cd flowrish-next
npm install
```

All dependencies (including Tiptap rich text editor packages) are installed automatically via `npm install`. No additional setup is needed for the editor.

## 2. Environment Variables

Copy the example file and fill in your credentials:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (Transaction/Pooler mode, port 6543). Add `?pgbouncer=true` at the end |
| `DIRECT_URL` | Supabase → Same page → Connection string (Session mode, port 5432). No pgbouncer param |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → Publishable key |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API → Secret key (server-only) |
| `UPSTASH_REDIS_REST_URL` | Upstash Console → Your database → REST API → URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console → Your database → REST API → Token |
| `INNGEST_EVENT_KEY` | Inngest Dashboard → Your app → Keys → Event Key |
| `INNGEST_SIGNING_KEY` | Inngest Dashboard → Your app → Keys → Signing Key |
| `EMAIL_ENCRYPTION_KEY` | Generate yourself (see below) |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client |
| `GOOGLE_CLIENT_SECRET` | Same place as above |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Same as `GOOGLE_CLIENT_ID` — needed client-side for the Gmail connect button in Settings |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AI_API_URL` | Gemini/OpenAI API endpoint | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `AI_API_KEY` | API key for AI service | — |
| `AI_MODEL` | Model name | `gemini-2.5-flash-lite-preview` |

### Generating EMAIL_ENCRYPTION_KEY

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Important Notes on DATABASE_URL

- Must use the **pooler** URL (goes through `pooler.supabase.com`), NOT the direct `db.xxx.supabase.co` URL
- Must include `?pgbouncer=true` at the end
- Do NOT add `&connection_limit=1` (causes timeouts)
- Port must be `6543` (transaction mode)

Example:
```
postgresql://postgres.yourproject:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

### Important Notes on DIRECT_URL

- Also uses the pooler URL but with port `5432` (session mode)
- Do NOT add `?pgbouncer=true`
- Used only for migrations

Example:
```
postgresql://postgres.yourproject:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

### About NEXT_PUBLIC_GOOGLE_CLIENT_ID

This is the same value as `GOOGLE_CLIENT_ID` but exposed to the browser. It's used by the Gmail connect component on the Settings page to initiate the OAuth flow client-side. Without it, the "Connect Gmail" button won't work.

## 3. Database Setup

### Generate Prisma Client

```bash
npx prisma generate
```

### Create Tables (First Time)

```bash
npx prisma migrate dev --name init
```

### Deploy Migrations (Production)

```bash
npx prisma migrate deploy
```

### Migration: Email Thread ID

If you're upgrading from a version without email threading in cadences, run:

```bash
npx prisma migrate dev --name add_email_thread_id
```

This adds the `emailThreadId` field to the `CadenceEnrollment` model, enabling follow-up emails in cadences to be sent as replies in the same Gmail thread.

### Migration: Rename Permissions (Production)

If upgrading from the old permission names (`users:manage`, `settings:manage`) to the new names (`admin:users`, `admin:settings`), run this SQL directly against your production database:

```sql
UPDATE "RolePermission" SET key = 'admin:users' WHERE key = 'users:manage';
UPDATE "RolePermission" SET key = 'admin:settings' WHERE key = 'settings:manage';
```

This ensures existing roles retain their permissions after the rename.

## 4. Supabase Auth Configuration

In your Supabase dashboard:

1. **Authentication → Providers → Email**: Enable email auth (magic links)
2. **Authentication → Providers → Google**: Enable and add your OAuth credentials
3. **Authentication → URL Configuration**:
   - Site URL: `https://your-app.vercel.app` (or `http://localhost:3000` for dev)
   - Redirect URLs: Add `https://your-app.vercel.app/auth/callback`

## 5. Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → Enable Gmail API
3. Configure OAuth consent screen (External, add email/profile/gmail scopes)
4. Create OAuth 2.0 credentials (Web application):
   - Authorized JavaScript origins: `https://your-app.vercel.app` (and `http://localhost:3000` for dev)
   - Authorized redirect URIs:
     - `https://your-supabase-ref.supabase.co/auth/v1/callback`
     - `https://your-app.vercel.app/auth/callback`
     - `http://localhost:3000/api/email/callback` (for local Gmail connect)
5. Copy Client ID and Client Secret to your env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`)
6. Add the same credentials to Supabase → Authentication → Providers → Google

## 6. Upstash Redis Setup

1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a database (pick the region closest to your Vercel deployment)
3. Copy the REST URL and Token from the database details page

## 7. Inngest Setup

1. Sign up at [inngest.com](https://www.inngest.com)
2. Create an app, get your Event Key and Signing Key
3. Set `INNGEST_SIGNING_KEY` as an environment variable (the SDK reads it automatically)
4. For local development, run the Inngest Dev Server:

```bash
npx inngest-cli@latest dev
```

The dev server connects to your app at `http://localhost:3000/api/inngest`.

5. For production, register your app URL in Inngest Cloud:
   - `https://your-app.vercel.app/api/inngest`

## 8. Running Locally

```bash
npm run dev
```

Visit `http://localhost:3000`. You'll be redirected to the login page.

## 9. Running Tests

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch
```

## 10. Production Deployment (Vercel)

1. Push to GitHub
2. Import the repo in Vercel
3. Set all environment variables in Vercel's dashboard (Settings → Environment Variables)
4. Set the function region to match your Supabase region (configured in `vercel.json`)
5. Deploy

The `vercel.json` configures:
- Build command: `prisma generate && next build`
- Function region: `sin1` (Singapore — change to match your Supabase region)
- API Cache-Control: `no-store`

### After First Deploy

1. Run migrations against production:
   ```bash
   DATABASE_URL="your-prod-url" DIRECT_URL="your-prod-direct-url" npx prisma migrate deploy
   ```
2. Update Supabase Auth redirect URLs to include your Vercel production URL
3. Register your Inngest app URL in Inngest Cloud
4. Run the permission rename SQL if upgrading (see section 3 above)

### CI/CD

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push:
- TypeScript strict check (`tsc --noEmit`)
- Full test suite (`vitest --run`)

## 11. Troubleshooting

### "Prepared statement already exists" error
Your `DATABASE_URL` is missing `?pgbouncer=true`. Add it.

### "Connection pool timeout" error
Remove `&connection_limit=1` from your `DATABASE_URL` if present.

### "Authentication failed" error
Your database password has special characters that aren't URL-encoded. Reset to an alphanumeric password in Supabase.

### "Table does not exist" error
You haven't run migrations. Run `npx prisma migrate dev --name init` (local) or `npx prisma migrate deploy` (production).

### "Query Engine not found" error on Vercel
The Prisma schema must use `provider = "prisma-client-js"` with `binaryTargets = ["native", "rhel-openssl-3.0.x"]`. Clear Vercel's build cache and redeploy.

### Google OAuth redirects to localhost
Update your Supabase Site URL (Authentication → URL Configuration) to your production URL.

### Gmail connect button doesn't work
Make sure `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set in your environment. This is the same value as `GOOGLE_CLIENT_ID` but must be separately defined for client-side access.

### User stuck on onboarding after login
The user has an account but no organization. Complete the onboarding form to create or join an org.

### Email threading not working in cadences
Run the migration: `npx prisma migrate dev --name add_email_thread_id`. This adds the `emailThreadId` column to `CadenceEnrollment`.
