# Architecture

## Overview

Flowrish CRM is a single Next.js 15 application using the App Router pattern. All business logic lives in server-side services, accessed through API route handlers and Server Actions. The frontend uses Server Components for initial data loading and TanStack Query for client-side cache management.

## Multi-Tenancy

Every data model (except User, Organization, and auth-related tables) is scoped to an organization via an `organizationId` foreign key.

### Tenant Isolation Middleware

```
src/server/db/middleware.ts → createTenantPrisma(organizationId)
```

This creates a Prisma client extension that automatically:
- **Injects `organizationId`** into all `create` operations
- **Filters by `organizationId`** on all `find`, `update`, `delete`, `count`, and `aggregate` operations

This means services never need to manually add `organizationId` to queries — it's enforced at the data layer.

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
                           │ (create org │  │  (redirect)  │       │
                           │  or join)   │  └──────────────┘       │
                           └────────────┘                          │
```

### Session Structure

```typescript
interface Session {
  authUser: SupabaseUser       // From Supabase auth.getUser()
  dbUser: SessionUser          // App User with team memberships + role permissions
  organizationId: string       // Resolved from default org membership
}
```

## Organization & Team Model

### Creation Flow

When a user creates an organization:

1. **Organization** record is created (name, slug)
2. **Default "General" team** is created under the org
3. **4 system roles** are created: OWNER (hierarchy 0), ADMIN (1), MANAGER (2), MEMBER (3)
4. Each role gets its predefined set of permissions (RolePermission records)
5. User is added as **OrganizationMember** (isDefault: true)
6. User is added as **TeamMember** on the General team with the OWNER role

### Invite Flow

When inviting a new user:

1. Inviter's privilege is checked (cannot invite with a higher-privilege role than your own)
2. An **OrganizationInvite** is created with 7-day expiration
3. When the invitee accepts:
   - Email match is verified
   - **OrganizationMember** is created
   - **TeamMember** is created (on specified team, or default "General" team)
   - Invite is marked as accepted

### Team Hierarchy

Teams support parent-child relationships via `parentTeamId`. This enables:
- Nested team structures (e.g., Sales → Sales West → Sales West LA)
- MANAGER inheritance: a manager of a parent team has access to all sub-teams

## RBAC (Role-Based Access Control)

### Role Hierarchy

| Role | Hierarchy | Lead Access |
|------|-----------|-------------|
| OWNER | 0 | All org leads |
| ADMIN | 1 | All org leads |
| MANAGER | 2 | Leads assigned to users in their teams + sub-teams |
| MEMBER | 3 | Only their own assigned leads |

### Permission System

Permissions are string keys (e.g., `leads:read`, `cadences:manage`) stored as RolePermission records. A user's effective permissions are the **union** of all permissions from all their team memberships.

Permission checks happen at two levels:
1. **Route level:** `requirePermission(user, 'leads:write')` — throws 403 before any business logic
2. **Data level:** `getLeadAccessFilter(user, orgId)` — returns a Prisma `where` clause that scopes queries

### Privilege Escalation Prevention

- Inviting: You cannot assign a role with higher privilege than your own
- Team membership: Users must be an OrganizationMember before joining any team

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

```
Event/Cron trigger
  → Inngest function
    → step.run('step-name', async () => { ... })
    → Uses tenant-scoped Prisma for each org
    → Retries on failure (3 attempts, exponential backoff)
```

Registered functions:
- **cadence-step-execution** — Executes cadence steps (email, call, LinkedIn, manual task)
- **email-sync** — Syncs Gmail inbox on demand
- **score-decay** — Daily lead score decay for inactive leads
- **task-reminder** — Hourly check for tasks due within 24 hours
- **forecast-snapshot** — Daily pipeline metrics snapshot

## Security

### Rate Limiting (Upstash Redis)

Three tiers enforced in Next.js middleware:
- **General:** 100 requests/minute per IP
- **Auth:** 10 requests/minute per IP (login, signup)
- **Write:** 30 requests/minute per IP (mutations)

### Brute-Force Protection

- 5 failed login attempts in 15 minutes → account lockout
- Lockout persists for full duration regardless of subsequent attempts
- Successful login resets the counter

### Input Validation

All inputs are validated with Zod schemas that include:
- Null byte stripping
- Path traversal detection
- Prototype pollution key rejection
- Type coercion and sanitization

### Security Headers

Set via Next.js middleware:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HSTS)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (restrictive)

## Soft Delete & Audit

- Leads use soft delete (`deletedAt` timestamp) — never appear in queries
- All CUD operations create immutable **AuditEntry** records
- Deletion requests go through an approval workflow (MEMBER requests, MANAGER/ADMIN approves)

## Pipeline & Stages

- Each org gets a default pipeline with 6 stages on first lead creation
- Stages have `isClosedWon` and `isClosedLost` flags for terminal states
- Moving a lead to a terminal stage sets `isClosed: true` and `closeDate`
- Moving back to an open stage clears `isClosed`
- All stage transitions are recorded in StageTransition for analytics
