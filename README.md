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

# Create database tables
npx prisma migrate dev --name init

# Start development server
npm run dev
```

Or use the start script:
```bash
# Linux/macOS
chmod +x start.sh && ./start.sh

# Windows
start.bat
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run test` | Run all tests (836 tests) |
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
├── lib/                    # Shared utilities
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
├── schema.prisma           # Database schema (28 tenant-scoped models)
└── seed.ts                 # Seed script
```

## Key Features

- **Multi-tenancy** — Complete data isolation between organizations via tenant middleware
- **RBAC** — 4-tier role system (Owner, Admin, Manager, Member) with permission-based access
- **Lead Management** — Full lifecycle with pipeline stages, soft-delete, and conversion to contacts
- **Cadence Engine** — Multi-step sales sequences with automated task/email creation
- **Rhythm Engine** — Priority-scored daily actions based on deal value, urgency, and engagement
- **Revenue Forecasting** — Pipeline metrics, AI predictions, and commit vs. actual tracking
- **Email Integration** — Gmail OAuth with personalization tags and inbox sync
- **AI Features** — Email generation, account research, and chatbot (Gemini/OpenAI)
- **CSV Import/Export** — Bulk lead import with duplicate detection and field mapping
- **Full-text Search** — PostgreSQL tsvector across leads, contacts, and companies
- **Audit Logging** — Immutable trail of all CUD operations
- **Score Decay** — Automated daily score reduction for inactive leads

## Documentation

- [Setup Guide](docs/SETUP_GUIDE.md) — Full environment setup and deployment
- [Architecture](docs/ARCHITECTURE.md) — System design, multi-tenancy, RBAC, data flow
- [User Manual](docs/USER_MANUAL.md) — Feature walkthrough and user flows

## Deployment

Deployed on Vercel with Supabase Cloud. See [Setup Guide](docs/SETUP_GUIDE.md) for full deployment instructions.

## License

Private — All rights reserved.
