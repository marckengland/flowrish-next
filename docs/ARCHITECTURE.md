# Architecture

## Overview

Flowrish CRM is a single Next.js 15 application using the App Router pattern. All business logic lives in server-side services, accessed through API route handlers and Server Actions. The frontend uses Server Components for initial data loading and TanStack Query for client-side cache management.

## Multi-Tenancy

Every data model (except User, Organization, and auth-related tables) is scoped to an organization via an `organizationId` foreign key. There are 28+ tenant-scoped models in total.

### Tenant Isolation Middleware

```
src/server/db/middleware.ts → createTenantPrisma(organizationId)
```

This creates a Prisma client extension that automatically:
- **Injects `organizationId`** into all `create` operations
- **Filters by `organizationId`** on all `find`, `update`, `delete`, `count`, and `aggregate` operations

Services never manually add `organizationId` to queries — it's enforced at the data layer.

### Organization ID Resolution

The `organizationId` is always resolved **server-side** from the authenticated user's default organization membership. It never comes from client input.

```
Session → OrganizationMember (isDefault: true) → organizationId
```

## Authentication Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Login Page │────▶│ Supabase Auth│────▶│ /auth/callback   │
│  (Magic/OAuth)    │  (hosted)    │     │ or /auth/confirm │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          ┌────────▼────────┐
                                          │ Check User record│
                                          │ in app database  │
                                          └────────┬────────┘
                                                   │
                                    ┌──────────────┼──────────────┐
                                    │ New User     │ Existing User │
                                    ▼              ▼               │
                           ┌────────────┐  ┌──────────────┐       │
                           │ Onboarding │  │  Dashboard   │       │
                           │ (create org │  │  (or onboard │       │
                           │  or join)   │  │  if no org)  │       │
                           └────────────┘  └──────────────┘       │
```

### Session Structure

```typescript
interface Session {
  authUser: SupabaseUser       // From Supabase auth.getUser()
  dbUser: SessionUser          // App User with team memberships + role permissions
  organizationId: string       // Resolved from default org membership
}
```

### Edge Cases Handled

- User authenticated but no org → redirected to `/onboarding`
- User on `/onboarding` but already has org → redirected to `/`
- Incomplete onboarding (org exists but no team membership) → auto-repaired in dashboard layout

## Organization & Team Model

### Creation Flow

When a user creates an organization (sequential operations, PgBouncer-compatible):

1. **Organization** record is created (name, slug)
2. **Default "General" team** is created under the org
3. **4 system roles** are created: OWNER (hierarchy 0), ADMIN (1), MANAGER (2), MEMBER (3)
4. Each role gets its predefined set of permissions (RolePermission records)
5. User is added as **OrganizationMember** (isDefault: true)
6. User is added as **TeamMember** on the General team with the OWNER role

### Invite Flow

1. Inviter's privilege is checked (cannot invite with a higher-privilege role)
2. **OrganizationInvite** is created with 7-day expiration
3. On acceptance: email match verified, OrganizationMember + TeamMember created

### Team Hierarchy

Teams support parent-child relationships via `parentTeamId`. A manager of a parent team has access to all sub-teams (recursive BFS traversal).

### Transfer Ownership

The OWNER can transfer ownership to another org member via `POST /api/admin/members/transfer-ownership`:
- Only the current OWNER can initiate
- Target must be an existing org member
- Current OWNER is downgraded to ADMIN after transfer
- Target user's role is upgraded to OWNER across all team memberships

### Leave Organization

Any member can leave via `POST /api/admin/members/leave`:
- Removes OrganizationMember and all TeamMember records
- Cannot leave if you're the last OWNER (must transfer ownership first)

## RBAC (Role-Based Access Control)

### Custom Role System

The application supports both **system roles** and **custom roles**:

**System Roles** (created automatically with each org):
- OWNER (hierarchy 0), ADMIN (1), MANAGER (2), MEMBER (3)
- Cannot be deleted or renamed
- Permissions CAN be modified by the OWNER

**Custom Roles** (created via Admin → Roles & Permissions):
- Created with `POST /api/admin/roles` — name, hierarchy level, and permission set
- Fully editable (name, hierarchy, permissions) via `PATCH /api/admin/roles/[id]`
- Deletable via `DELETE /api/admin/roles/[id]` (only if no members assigned)
- Privilege escalation prevention: cannot create a role more powerful than your own

### Permission System

Permissions are string keys assigned to roles. A user's effective permissions are the **union** of all permissions from all their team memberships.

Current permission keys:

| Permission | Description |
|-----------|-------------|
| `leads:read` | View leads |
| `leads:write` | Create/edit leads |
| `leads:delete` | Delete leads directly |
| `contacts:read` | View contacts |
| `contacts:write` | Create/edit contacts |
| `cadences:manage` | Create/edit/delete cadences |
| `cadences:read` | View cadences |
| `users:invite` | Invite new users |
| `admin:users` | Manage users, roles, teams |
| `admin:settings` | Manage org settings, approve deletions |
| `billing:manage` | Manage billing (OWNER only) |
| `audit:read` | View audit log |
| `forecast:read` | View forecasts |
| `forecast:submit` | Submit forecast commits |

### Role Hierarchy

| Role | Hierarchy | Lead Access | Key Permissions |
|------|-----------|-------------|-----------------|
| OWNER | 0 | All org leads | All 14 permissions |
| ADMIN | 1 | All org leads | All except billing:manage |
| MANAGER | 2 | Leads in their teams + sub-teams | Leads, cadences, forecast |
| MEMBER | 3 | Only their own assigned leads | Read leads, contacts, cadences |
| Custom | N | Depends on permissions assigned | Configurable |

### Access Filter

`getLeadAccessFilter(user, organizationId)` returns a Prisma `where` clause:
- OWNER/ADMIN: `{ deletedAt: null }` (all leads)
- MANAGER: `{ deletedAt: null, assignedUserId: { in: [team member IDs] } }`
- MEMBER: `{ deletedAt: null, assignedUserId: userId }`

### Security Guards

- Privilege escalation prevention: cannot invite/create with a role higher than your own
- Org membership required before team membership
- organizationId always server-derived, never from client

## Rich Text Email Editor

### Architecture

```
┌──────────────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Tiptap Editor       │────▶│  HTML Output     │────▶│  Gmail API   │
│  (Client Component)  │     │  (rich content)  │     │  (send)      │
└──────────────────────┘     └─────────────────┘     └──────────────┘
```

**Component:** `src/components/email/rich-text-editor.tsx`

**Tiptap Extensions Used:**
- `@tiptap/starter-kit` — Bold, italic, headings, lists, blockquotes, code
- `@tiptap/extension-underline` — Underline formatting
- `@tiptap/extension-link` — Clickable links with URL editing
- `@tiptap/extension-color` — Text color picker
- `@tiptap/extension-text-style` — Base for color/font extensions
- `@tiptap/extension-font-family` — Font family selection

**Data Flow:**
1. User composes email in Tiptap editor (WYSIWYG)
2. Editor outputs clean HTML string via `onChange` callback
3. HTML is passed to `POST /api/email/send` as the `body` field
4. Server replaces personalization tags (`{{FirstName}}`, etc.) in the HTML
5. Server wraps HTML in a full email document template (`wrapHtmlEmail()`)
6. Encoded as RFC 2822 MIME message with `Content-Type: text/html; charset=utf-8`
7. Sent via Gmail API (`POST gmail.googleapis.com/gmail/v1/users/me/messages/send`)

**File Attachments:**
- Uploaded via `POST /api/upload` (max 25 MB)
- Attached to the email compose UI
- Sent as part of the email payload

## Email Threading in Cadences

### Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  CadenceEnrollment  │     │  Cadence Step Exec   │     │  Gmail API      │
│  emailThreadId: ?   │────▶│  (Inngest function)  │────▶│  (threaded send)│
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
```

**How it works:**

1. When a lead is enrolled in a cadence, `emailThreadId` on `CadenceEnrollment` starts as `null`
2. When the first EMAIL step executes, the email is sent as a new message
3. The Gmail API returns a `threadId` — this is stored on the enrollment's `emailThreadId` field
4. Subsequent EMAIL steps in the same cadence check for `emailThreadId`:
   - If present: subject is prefixed with `Re:` and sent as a reply in the same thread
   - If absent: sent as a new thread (first email)
5. This ensures all cadence emails to a lead appear as a single conversation in Gmail

**Schema:**
```prisma
model CadenceEnrollment {
  // ...
  emailThreadId    String?  // Gmail thread ID for email threading across steps
  // ...
}
```

## Duplicate Detection & Merge

### Detection

`POST /api/duplicates/check` accepts `{ contactEmail?, companyName? }` and returns potential duplicate leads matching by:
- Case-insensitive email match
- Fuzzy company name match

### Merge

`POST /api/leads/[id]/merge` with `{ secondaryLeadId }`:
- The `[id]` param is the **primary** lead (retains its data)
- The secondary lead's activities and contacts are transferred to the primary
- Duplicate contacts (same email) are skipped during transfer
- The secondary lead is soft-deleted after merge

## Deletion Request Workflow

For users without `leads:delete` permission (typically MEMBER role):

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│  User submits│────▶│  DeletionRequest     │────▶│  Admin approves  │
│  request     │     │  (status: PENDING)   │     │  or rejects      │
└──────────────┘     └─────────────────────┘     └──────────────────┘
```

**API Routes:**
- `POST /api/deletion-requests` — Create request (any user)
- `GET /api/deletion-requests` — List requests (filtered by role)
- `PATCH /api/deletion-requests/[id]/approve` — Approve and execute deletion (requires `admin:settings`)
- `PATCH /api/deletion-requests/[id]/reject` — Reject request (requires `admin:settings`)

**Behavior:**
- Duplicate pending requests for the same entity are rejected
- Approved: soft-delete for leads, hard delete for contacts/tasks
- Rejected: request marked as rejected, no deletion occurs

## Admin API Routes

All routes under `/api/admin/` are protected by permission checks:

| Route | Methods | Permission | Description |
|-------|---------|-----------|-------------|
| `/api/admin/roles` | GET, POST | `admin:users` | List all roles; create custom role |
| `/api/admin/roles/[id]` | PATCH, DELETE | `admin:users` | Update/delete custom role |
| `/api/admin/members` | GET | `admin:users` | List org members |
| `/api/admin/members/[id]` | PATCH, DELETE | `admin:users` | Update role / remove member |
| `/api/admin/members/transfer-ownership` | POST | (OWNER only) | Transfer OWNER role |
| `/api/admin/members/leave` | POST | (any member) | Leave organization |
| `/api/admin/invite` | POST | `users:invite` | Send invite |
| `/api/admin/teams` | GET, POST | `admin:users` | List/create teams |
| `/api/admin/teams/hierarchy` | GET | `admin:users` | Team tree |
| `/api/admin/audit` | GET | `audit:read` | Query audit log |
| `/api/admin/assignment-rules` | GET, POST | `admin:settings` | Assignment rules |
| `/api/admin/assignment-rules/[id]` | PATCH, DELETE | `admin:settings` | Manage rules |
| `/api/admin/scoring-rules` | GET, POST | `admin:settings` | Scoring rules |
| `/api/admin/scoring-rules/[id]` | PATCH, DELETE | `admin:settings` | Manage rules |
| `/api/admin/score-decay` | GET, POST | `admin:settings` | Score decay config |
| `/api/admin/score-decay/[id]` | PATCH, DELETE | `admin:settings` | Manage decay |
| `/api/admin/ai-prompts` | GET, POST | `admin:settings` | AI prompt templates |
| `/api/admin/ai-prompts/[id]` | PATCH, DELETE | `admin:settings` | Manage prompts |

## Feature Interconnections

These features are automatically triggered by other features:

| Trigger | Effect |
|---------|--------|
| Lead created (no assignee) | Assignment rules evaluated automatically |
| Activity logged on a lead | Lead score recalculated, lastActivityAt updated |
| Email sent to a lead | EMAIL activity created on timeline, lastActivityAt updated |
| Task completed | NOTE activity created on lead timeline |
| Lead moved to terminal stage | isClosed + closeDate set |
| Lead converted to contact | Contact created, cadence enrollments exited |
| Cadence step executed (EMAIL) | Email sent in thread, activity created on lead |
| Cadence step executed (CALL/LINKEDIN/TASK) | Task created for the rep |
| Score decay (daily cron) | Inactive lead scores reduced, ScoreHistory entries created |
| Forecast snapshot (daily cron) | Pipeline metrics calculated and stored |
| Deletion request approved | Entity soft-deleted (leads) or hard-deleted (contacts/tasks) |

## Data Flow

### Server Components (Initial Load)

```
Page (Server Component)
  → requireSession()
  → service.getData(orgId)  // Uses tenant-scoped Prisma
  → Render HTML with data
```

### Client Mutations

```
Client Component
  → Server Action (or API route)
    → requireSession()
    → requirePermission()
    → Zod validation
    → service.mutate()
    → revalidatePath()
```

### Rich Text Email Send

```
Tiptap Editor (client)
  → HTML string
  → POST /api/email/send { leadId, subject, body }
    → requireSession()
    → requirePermission('leads:write')
    → replacePersonalizationTags(body, lead)
    → wrapHtmlEmail(personalizedBody)
    → buildRawEmail(to, subject, htmlBody)  // RFC 2822 + base64url
    → Gmail API send
    → Create EmailMessage record
    → Create EMAIL activity on lead
```

### Background Jobs (Inngest)

5 registered functions:
- **cadence-step-execution** — Executes cadence steps (creates tasks/activities, sends threaded emails)
- **email-sync** — Syncs Gmail inbox on demand
- **score-decay** — Daily lead score decay for inactive leads
- **task-reminder** — Hourly check for tasks due within 24 hours
- **forecast-snapshot** — Daily pipeline metrics snapshot

## Security

### Rate Limiting (Upstash Redis)

Three tiers enforced in Next.js middleware:
- **General:** 100 requests/minute per IP
- **Auth:** 10 requests/minute per IP
- **Write:** 30 requests/minute per IP

### Brute-Force Protection

5 failed login attempts in 15 minutes → account lockout for full duration.

### Input Validation

All inputs validated with Zod schemas including null byte stripping, path traversal detection, and prototype pollution key rejection.

### Security Headers

Set via middleware: X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy.

## Database Considerations

### PgBouncer Compatibility

Supabase uses PgBouncer in transaction mode. This means:
- **No interactive transactions** (`$transaction(async (tx) => {...})`) — use sequential operations instead
- **`?pgbouncer=true`** required on DATABASE_URL to disable prepared statements
- Connection pooling is handled by PgBouncer, not Prisma

### Prisma Configuration

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "rhel-openssl-3.0.x"]
}
```

- `prisma-client-js` (not `prisma-client`) for Vercel compatibility
- `rhel-openssl-3.0.x` binary target for Vercel's Linux runtime
- Default output path (`node_modules/.prisma/client`) for reliable bundling

### Type Safety

The `tenantData()` helper (`src/server/db/types.ts`) provides type-safe Prisma create operations without `as any` casts. It bridges the gap between Prisma's types (which require organizationId) and the tenant middleware (which injects it automatically).
