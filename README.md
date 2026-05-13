# Flowrish CRM — Next.js + Supabase

A modern, multi-tenant CRM built with Next.js 15 (App Router), Supabase Auth, Prisma v6, and deployed to Vercel.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **Auth:** Supabase Auth (Magic Link + Google OAuth)
- **Database:** PostgreSQL via Supabase + Prisma v6 ORM
- **Background Jobs:** Inngest (durable functions, cron schedules)
- **Rate Limiting:** Upstash Redis
- **UI:** Tailwind CSS v4, Shadcn/ui, Lucide icons
- **State:** TanStack Query v5 (server), Zustand v5 (client)
- **Testing:** Vitest v3, fast-check v3 (property-based), Testing Library
- **Deployment:** Vercel + Supabase Cloud

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Fill in your Supabase, Upstash, Inngest, and AI API credentials

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Seed default data (roles, pipeline)
npx prisma db seed

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run test` | Run all tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | ESLint check |

## Project Structure

```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── (auth)/             # Auth pages (login, onboarding)
│   ├── (dashboard)/        # Authenticated dashboard pages
│   ├── api/                # REST API route handlers
│   └── auth/               # OAuth callback and magic link confirm
├── components/             # React components (Shadcn/ui based)
├── hooks/                  # TanStack Query hooks
├── lib/                    # Shared utilities (env, errors, encryption, validators)
│   ├── supabase/           # Supabase client factories (server, browser, middleware)
│   ├── upstash/            # Redis + rate limiting
│   └── validators/         # Zod schemas for all entities
├── server/                 # Server-only code
│   ├── actions/            # Server Actions (form mutations)
│   ├── auth/               # Session + RBAC permissions
│   ├── db/                 # Prisma client + tenant isolation middleware
│   ├── inngest/            # Background job functions
│   └── services/           # Business logic services
├── stores/                 # Zustand stores (layout, filters, kanban)
└── types/                  # TypeScript type definitions
prisma/
├── schema.prisma           # Database schema
└── seed.ts                 # Seed script (default roles, pipeline)
```

## Documentation

- [Setup Guide](docs/SETUP_GUIDE.md) — Full environment setup and deployment
- [Architecture](docs/ARCHITECTURE.md) — System design, multi-tenancy, RBAC
- [User Manual](docs/USER_MANUAL.md) — Feature walkthrough and user flows

## License

Private — All rights reserved.
