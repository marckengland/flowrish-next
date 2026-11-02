# Flowrish CRM — Next.js + Supabase

A modern, multi-tenant CRM built with Next.js 15 (App Router), Supabase Auth, Prisma v6, and deployed to Vercel.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **Auth:** Supabase Auth (Magic Link + Google OAuth)
- **Database:** PostgreSQL via Supabase + Prisma v6 ORM
- **Background Jobs:** Inngest (durable functions, cron schedules)
- **Rate Limiting:** Upstash Redis
- **UI:** Tailwind CSS v4, Shadcn/ui, Lucide icons
- **Rich Text Editor:** Tiptap v3 (email composition with formatting, links, colors)
- **State:** TanStack Query v5 (server), Zustand v5 (client)
- **Testing:** Vitest v3, fast-check v3 (property-based), Testing Library (unit); Playwright (end-to-end)
- **Deployment:** Vercel + Supabase Cloud

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Fill in your Supabase, Upstash, Inngest, Google, and AI API credentials

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
| `npm run dev` | Start Next.js dev server (`:3000`) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint check |
| `npm run typecheck:fast` | Type-check with no emit (`tsgo --noEmit`) |
| `npm run test` | Run the unit/integration suite once |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:receptionist:integration` | Receptionist migration, concurrency, and rollback checks on disposable PostgreSQL (Docker required) |
| `npm run test:e2e` | Playwright e2e against a local dev server (auto-started on `:3100`) |
| `npm run test:e2e:ui` | Playwright e2e in interactive UI mode |
| `npm run test:e2e:prod` | Playwright e2e against a deployed URL (read-only smoke) |
| `npm run test:e2e:install` | Install the Chromium browser Playwright needs (first-time) |
| `npm run seed:demo` | Seed demo data for the test org (`seed:demo:clean` to reset first) |
| `npm run setup:storage` | Provision the Supabase storage bucket for attachments |

See **[docs/TESTING.md](docs/TESTING.md)** for how the unit and e2e layers work, including `test:e2e` vs `test:e2e:prod`.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── (auth)/             # Auth pages (login, onboarding)
│   ├── (dashboard)/        # Authenticated dashboard pages
│   ├── api/                # REST API route handlers
│   │   ├── admin/          # Admin-only routes (roles, members, teams, etc.)
│   │   ├── cadences/       # Cadence CRUD + enrollments
│   │   ├── deletion-requests/ # Deletion request workflow
│   │   ├── duplicates/     # Duplicate detection
│   │   ├── email/          # Gmail connect, send, callback
│   │   └── ...             # leads, contacts, tasks, forecast, etc.
│   └── auth/               # OAuth callback and magic link confirm
├── components/             # React components (Shadcn/ui based)
│   ├── email/              # Rich text editor (Tiptap), email compose
│   └── ...
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
├── schema.prisma           # Database schema (~40 models, 33 tenant-scoped)
└── seed.ts                 # Seed script
```

## Key Features

- **Multi-tenancy** — Complete data isolation between organizations via tenant middleware
- **Custom Role Management** — Create, edit, and delete custom roles with granular permission toggles; 4 system roles (Owner, Admin, Manager, Member) with editable permissions
- **Rich Text Email Editor** — Tiptap-powered editor with bold, italic, underline, font families, text colors, links, and file attachments
- **Email Threading** — Cadence follow-up emails are sent as replies in the same conversation (Gmail thread, or Outlook conversation via Graph `createReply`), tracked by `emailThreadId` on enrollments
- **Lead Management** — Full lifecycle with pipeline stages, soft-delete, and conversion to contacts
- **Duplicate Detection & Merge** — Detect potential duplicates by email/company and merge leads (activities + contacts transferred)
- **Cadence Engine** — Multi-step sales sequences with automated task/email creation and email threading
- **Rhythm Engine** — Priority-scored daily actions based on deal value, urgency, and engagement
- **Revenue Forecasting** — Pipeline metrics, AI predictions, and commit vs. actual tracking
- **Email Integration** — Gmail **and Microsoft 365 / Outlook** (Microsoft Graph) with OAuth, personalization tags, inbox sync, threaded replies, and rich HTML emails. Encrypted tokens; cadence email steps work with either provider automatically
- **Calling** — Bring-your-own **click-to-call**: free `tel:` dialer + call logging out of the box, and optional **in-browser calling via Twilio** (per-org credentials, encrypted at rest; TwiML webhook signature verification). A provider comparison (Twilio/Telnyx/SignalWire/Plivo/Bandwidth) with self-serve setup guides lives in Settings
- **Automatic mailbox sync** — Five-minute Gmail/Microsoft checks via Inngest, paginated checkpoint recovery, per-mailbox sync health, and failure alerts. Requires registered production background jobs; see the [guide](docs/AUTOMATIC_MAILBOX_SYNC.md)
- **Conversation-based follow-up drafts** — Generate replies from the full source Gmail/Outlook conversation, edit before sending, and reject stale or mismatched mailbox/thread versions. See the [guide](docs/CONVERSATION_DRAFTS.md)
- **Follow-up inbox** — Review matched sales replies and confirmed callbacks, edit and approve tasks, dismiss suggestions, and open email drafts for explicit sending. Qualifying synced replies stop their cadence; see the [guide](docs/FOLLOW_UP_INBOX.md)
- **AI receptionist** — Optional inbound Twilio receptionist with approved FAQs, after-hours scheduling, confirmed callback capture, assigned tasks, and call history. Disabled by default; see the [setup guide](docs/AI_RECEPTIONIST.md)
- **Marketing landing page** — public `/` landing (auth-aware CTAs); the authenticated app lives under `/dashboard`
- **AI Features** — Email generation, account research, and **Airish**, the in-app AI chatbot assistant. Provider-agnostic: runs on any OpenAI-compatible LLM — OpenAI, Anthropic (Claude), DeepSeek, Google Gemini (default), or OpenRouter (open-weight models like Kimi, GLM, Llama, Qwen) — via `LLM_PROVIDER`
- **CSV Import/Export** — Bulk lead import with duplicate detection and field mapping
- **Full-text Search** — PostgreSQL tsvector across leads, contacts, and companies
- **Audit Logging** — Immutable trail of all CUD operations
- **Score Decay** — Automated daily score reduction for inactive leads
- **Deletion Request Workflow** — Non-admin users request deletion; admins approve/reject
- **Transfer Ownership** — Owner can transfer the OWNER role to another member
- **Leave Organization** — Members can leave (owners must transfer first)

## Admin API Routes

All routes under `/api/admin/` require `admin:users` or `admin:settings` permission:

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/admin/roles` | GET, POST | List roles with permissions; create custom role |
| `/api/admin/roles/[id]` | PATCH, DELETE | Update role permissions/name; delete custom role |
| `/api/admin/members` | GET | List organization members |
| `/api/admin/members/[id]` | PATCH, DELETE | Update member role; remove member |
| `/api/admin/members/transfer-ownership` | POST | Transfer OWNER role to another member |
| `/api/admin/members/leave` | POST | Leave the organization |
| `/api/admin/invite` | POST | Invite a user to the organization |
| `/api/admin/teams` | GET, POST | List/create teams |
| `/api/admin/teams/hierarchy` | GET | Get team hierarchy tree |
| `/api/admin/audit` | GET | Query audit log entries |
| `/api/admin/assignment-rules` | GET, POST | List/create assignment rules |
| `/api/admin/assignment-rules/[id]` | PATCH, DELETE | Update/delete assignment rule |
| `/api/admin/scoring-rules` | GET, POST | List/create lead scoring rules |
| `/api/admin/scoring-rules/[id]` | PATCH, DELETE | Update/delete scoring rule |
| `/api/admin/score-decay` | GET, POST | List/create score decay configs |
| `/api/admin/score-decay/[id]` | PATCH, DELETE | Update/delete score decay config |
| `/api/admin/ai-prompts` | GET, POST | List/create AI prompt templates |
| `/api/admin/ai-prompts/[id]` | PATCH, DELETE | Update/delete AI prompt |
| `/api/admin/voice-provider` | GET, PATCH | Get/set the org's preferred calling provider |
| `/api/admin/voice-config` | GET, PUT, DELETE | Get (masked) / save / clear the org's encrypted Twilio credentials |

### Other integration routes

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/voice/token` | GET | Mint a Twilio Voice access token from the org's own credentials (or `{ configured:false }`) |
| `/api/voice/twiml` | POST | TwiML webhook Twilio calls to bridge browser→PSTN (signature-verified) |
| `/api/email/callback` | GET | Gmail OAuth popup callback |
| `/api/email/microsoft/callback` | GET | Microsoft/Outlook OAuth popup callback |
| `/api/email/account` | GET, DELETE | Connected mailbox (`?provider=gmail\|microsoft`) |
| `/api/email/sync` | POST | Trigger inbox sync for the connected mailbox |

## Documentation

- [Setup Guide](docs/SETUP_GUIDE.md) — Full environment setup and deployment
- [Architecture](docs/ARCHITECTURE.md) — System design, multi-tenancy, RBAC, data flow
- [User Manual](docs/USER_MANUAL.md) — Feature walkthrough and user flows
- [Integrations Guide](docs/INTEGRATIONS.md) — Calling (Twilio), email (Gmail + Microsoft/Outlook), and CRM migration setup + how they work
- [Testing Guide](docs/TESTING.md) — Unit (Vitest) and end-to-end (Playwright) testing, local vs. prod runs

## Deployment

Deployed on Vercel with Supabase Cloud. See [Setup Guide](docs/SETUP_GUIDE.md) for full deployment instructions.

## License

Private — All rights reserved.
