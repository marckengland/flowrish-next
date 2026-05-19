# Architecture

## Overview

Flowrish CRM is a single Next.js 15 application using the App Router pattern. All business logic lives in server-side services, accessed through API route handlers and Server Actions. The frontend uses Server Components for initial data loading and TanStack Query for client-side cache management.

## Multi-Tenancy

Every data model (except User, Organization, and auth-related tables) is scoped to an organization via an `organizationId` foreign key. There are 28 tenant-scoped models in total.

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

## RBAC (Role-Based Access Control)

### Role Hierarchy

| Role | Hierarchy | Lead Access | Key Permissions |
|------|-----------|-------------|-----------------|
| OWNER | 0 | All org leads | Everything (14 permissions) |
| ADMIN | 1 | All org leads | Everything except billing |
| MANAGER | 2 | Leads in their teams + sub-teams | Leads, cadences, forecast |
| MEMBER | 3 | Only their own assigned leads | Read leads, contacts, cadences |

### Permission System

Permissions are string keys (e.g., `leads:read`, `cadences:manage`). A user's effective permissions are the **union** of all permissions from all their team memberships.

### Access Filter

`getLeadAccessFilter(user, organizationId)` returns a Prisma `where` clause:
- OWNER/ADMIN: `{ deletedAt: null }` (all leads)
- MANAGER: `{ deletedAt: null, assignedUserId: { in: [team member IDs] } }`
- MEMBER: `{ deletedAt: null, assignedUserId: userId }`

### Security Guards

- Privilege escalation prevention: cannot invite with a role higher than your own
- Org membership required before team membership
- organizationId always server-derived, never from client

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
| Cadence step executed | Task or activity created on lead (EMAIL/CALL/LINKEDIN/MANUAL_TASK) |
| Score decay (daily cron) | Inactive lead scores reduced, ScoreHistory entries created |
| Forecast snapshot (daily cron) | Pipeline metrics calculated and stored |

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

### Background Jobs (Inngest)

5 registered functions:
- **cadence-step-execution** — Executes cadence steps (creates tasks/activities)
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
