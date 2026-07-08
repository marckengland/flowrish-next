# Implementation Plan: flowrish-next (Next.js + Supabase CRM)

## Overview

This plan implements the greenfield rebuild of Flowrish CRM as a single Next.js 15 App Router application deployed to Vercel + Supabase. Tasks are organized to build foundational infrastructure first (project setup, auth, multi-tenancy), then layer on feature modules incrementally. Each task builds on previous steps, ensuring no orphaned code.

## Tasks

- [x] 1. Project scaffolding, environment, and core infrastructure
  - [x] 1.1 Initialize Next.js 15 project with TypeScript strict mode and configure tooling
    - Create Next.js 15 app with App Router (`create-next-app` with TypeScript)
    - Configure `tsconfig.json` with `strict: true`, path aliases (`@/`)
    - Set up `package.json` with exact pinned versions (no `^` or `~`)
    - Install and configure: Tailwind CSS v4, Shadcn/ui, Prisma v6, Zod v3, TanStack Query v5, Zustand v5
    - Install dev dependencies: Vitest v3, fast-check v3, `@testing-library/react`
    - Create `vitest.config.ts` with path aliases and test file patterns
    - Create folder structure: `src/app/`, `src/components/`, `src/lib/`, `src/hooks/`, `src/stores/`, `src/types/`, `src/server/`
    - _Requirements: 26.1, 26.5, 26.6, 26.7, 26.8, 26.9, 26.10_

  - [x] 1.2 Implement environment variable validation with Zod
    - Create `src/lib/env.ts` with Zod schema validating all required env vars
    - Validate URL-type vars are valid URLs, key-type vars are non-empty strings
    - Support optional vars with defaults (AI_API_URL, AI_MODEL)
    - Export typed `env` object — halt startup with descriptive errors on validation failure
    - _Requirements: 22.1, 22.2, 22.3, 22.4_

  - [x] 1.3 Create shared error handling utilities and types
    - Create `src/lib/errors.ts` with `AppError` class (code, message, statusCode)
    - Create `errorResponse()` helper producing consistent `{ error: { code, message } }` JSON
    - Handle ZodError → 400, AppError → custom status, unknown → 500 (no internals exposed)
    - Create `src/types/api.ts` with request/response type definitions
    - Create `src/types/permissions.ts` with Permission enum/union type
    - _Requirements: 25.1, 25.2, 25.3_

  - [x] 1.4 Set up Prisma v6 schema with multi-tenant data models
    - Create `prisma/schema.prisma` with datasource (pooled DATABASE_URL + direct DIRECT_URL)
    - Define Organization, OrganizationMember, OrganizationInvite, Team, TeamMember, Role, RolePermission models
    - Define User model with authId (Supabase auth.users.id mapping)
    - Define Lead model with fields including `isClosed`, `closeDate`, `lastActivityAt`, `deletedAt`, `searchVector`
    - Define Contact, Company, LeadContact models with `searchVector` on Contact and Company
    - Define Pipeline, Stage (with `isClosedWon`, `isClosedLost` flags), StageTransition models
    - Define Activity, Task, Cadence, CadenceStep, CadenceEnrollment, StepExecutionLog models
    - Define EmailAccount, EmailMessage, FileAttachment, AuditEntry models
    - Define ScoringRule, ScoreHistory, ScoreDecayConfig, AssignmentRule models
    - Define ForecastSubmission, ForecastSnapshot, AiPromptConfig, CoachingComment, DeletionRequest models
    - Define FieldMapping model (for reusable CSV import mappings)
    - Add `organizationId` FK + index to all tenant-scoped models
    - Generate Prisma client
    - _Requirements: 2.1, 2.4, 2.5, 4.6, 23.4, 34.1, 34.2_

  - [x] 1.5 Implement Prisma client singleton and tenant isolation middleware
    - Create `src/server/db/client.ts` with global Prisma singleton (hot-reload safe)
    - Create `src/server/db/middleware.ts` with `tenantIsolationMiddleware` using Prisma `$extends`
    - Implement `createTenantPrisma(organizationId)` that auto-injects organizationId into all queries/mutations for tenant-scoped models
    - Ensure create, findMany, findFirst, findUnique, update, delete, count, aggregate all get organizationId injected
    - _Requirements: 2.2, 2.9_

  - [x] 1.6 Write property tests for tenant isolation middleware
    - **Property: organizationId injection invariant** — For any tenant-scoped model operation, the resulting query always contains the correct organizationId
    - **Property: Non-tenant models pass through** — Operations on non-tenant-scoped models are unmodified
    - **Validates: Requirements 2.1, 2.2**

  - [x] 1.7 Create Zod validation schemas for all entities
    - Create `src/lib/validators/leads.ts` — leadCreateSchema, leadUpdateSchema
    - Create `src/lib/validators/activities.ts` — activityCreateSchema
    - Create `src/lib/validators/cadences.ts` — cadenceCreateSchema, stepCreateSchema, enrollSchema
    - Create `src/lib/validators/tasks.ts` — taskCreateSchema, taskUpdateSchema
    - Create `src/lib/validators/common.ts` — sanitizedString, safeJsonBody, pagination schemas
    - Include input sanitization: null byte stripping, path traversal detection, prototype pollution check
    - _Requirements: 21.2, 21.4, 21.5, 21.6, 26.2_


  - [x] 1.8 Write property tests for input validation schemas
    - **Property: Sanitized strings never contain null bytes or path traversal sequences**
    - **Property: Prototype pollution keys are always rejected**
    - **Validates: Requirements 21.4, 21.5, 21.6**

- [x] 2. Authentication and session management
  - [x] 2.1 Set up Supabase client factories (server, middleware, browser)
    - Create `src/lib/supabase/server.ts` — `createSupabaseServer()` using `@supabase/ssr` with cookie handling
    - Create `src/lib/supabase/middleware.ts` — `createSupabaseMiddleware(request, response)` for Next.js middleware
    - Create `src/lib/supabase/client.ts` — `createSupabaseBrowser()` for client components
    - _Requirements: 1.6_

  - [x] 2.2 Implement session utilities (getSession, requireSession)
    - Create `src/server/auth/session.ts`
    - `getSession()`: validate Supabase user via `getUser()`, fetch app User with teamMemberships and role permissions
    - `requireSession()`: throw 401 AuthError if no valid session
    - Include organizationId resolution from user's default organization membership
    - _Requirements: 1.2, 1.5, 1.7_

  - [x] 2.3 Implement RBAC permission checker
    - Create `src/server/auth/permissions.ts`
    - Define Permission type union (leads:read, leads:write, cadences:manage, etc.)
    - `hasPermission(user, permission)`: compute effective permissions as union of all team role permissions
    - `requirePermission(user, permission)`: throw 403 AppError if permission missing
    - `getEffectivePermissions(userId, organizationId)`: resolve full permission set including team hierarchy
    - `getSubTeamIds(teamId)`: recursive descendant team resolution
    - _Requirements: 3.1, 3.6, 3.7, 3.8, 3.9_

  - [x] 2.4 Write property tests for RBAC permission system
    - **Property: Adding a higher role never reduces accessible resources (monotonic)**
    - **Property: MEMBER can never access leads not assigned to them**
    - **Property: Permission union across multiple teams is commutative**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.5 Create auth routes (login page, magic link, OAuth callback, confirm)
    - Create `src/app/(auth)/login/page.tsx` — login form with email input + Google OAuth button
    - Create `src/app/auth/callback/route.ts` — OAuth callback handler (exchange code, check/create User record, redirect)
    - Create `src/app/auth/confirm/route.ts` — Magic link confirmation (verify OTP, check/create User, redirect)
    - Handle new user flow: create User record, redirect to onboarding
    - Handle existing user flow: redirect to dashboard
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.6 Implement Next.js middleware (auth + security headers + rate limiting)
    - Create `src/middleware.ts` with matcher config
    - Set security headers: X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, Permissions-Policy
    - Integrate Upstash rate limiting (general/auth/write tiers)
    - Return 429 with rate limit headers when exceeded
    - Validate session via Supabase middleware client
    - Redirect unauthenticated users to /login for protected routes
    - Return 401 for unauthenticated API requests (except /api/auth and /api/inngest)
    - _Requirements: 1.5, 1.7, 15.1, 15.2, 15.3, 21.1_

  - [x] 2.7 Implement Upstash Redis rate limiting and brute-force protection
    - Create `src/lib/upstash/redis.ts` — Redis client instance
    - Create `src/lib/upstash/ratelimit.ts` — three rate limiter instances (general: 100/min, auth: 10/min, write: 30/min)
    - Implement `recordLoginFailure(ip, email)` — increment counter, lock after 5 failures in 15 min
    - Implement `isLoginLockedOut(ip, email)` — check lockout status
    - Implement `clearLoginFailures(ip, email)` — clear on successful login
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 2.8 Write property tests for rate limiting logic
    - **Property: Request count never exceeds configured limit within sliding window**
    - **Property: Successful login always resets brute-force counter to zero**
    - **Property: Lockout persists for full duration regardless of subsequent attempts**
    - **Validates: Requirements 15.1, 15.4, 15.5**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Multi-tenancy, organizations, and team management
  - [x] 4.1 Implement organization service (create, join, invite)
    - Create `src/server/services/organizations.ts`
    - `createOrganization(name, slug, ownerId)`: create org, default team, assign OWNER role
    - `inviteToOrganization(email, orgId, roleId, teamId)`: create invite with expiration
    - `acceptInvite(inviteId, userId)`: create OrganizationMember + TeamMember, mark invite accepted
    - Auto-create default roles (OWNER, ADMIN, MANAGER, MEMBER) with system permissions on org creation
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 4.2 Implement team hierarchy service
    - Create `src/server/services/teams.ts`
    - `createTeam(name, orgId, parentTeamId?)`: create team with optional parent
    - `addTeamMember(userId, teamId, roleId)`: add member with role
    - `getTeamHierarchy(orgId)`: return full tree structure
    - `getAccessibleTeamIds(userId, orgId)`: resolve all teams user has access to (including sub-teams for managers)
    - _Requirements: 2.5, 2.8, 3.8_

  - [x] 4.3 Implement lead access scoping (RBAC-filtered queries)
    - Create `src/server/services/access.ts`
    - `getLeadAccessFilter(user)`: return Prisma where clause based on role
    - OWNER/ADMIN: all org leads (deletedAt: null)
    - MANAGER: leads assigned to users in their teams + sub-teams
    - MEMBER: only own assigned leads
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

  - [x] 4.4 Write property tests for multi-tenancy isolation
    - **Property: A user can never read data from an Organization they are not a member of**
    - **Property: Adding a user to a Team never grants access to a different Organization**
    - **Property: organizationId is always derived server-side, never from client input**
    - **Validates: Requirements 2.1, 2.2, 2.9**

  - [x] 4.5 Create onboarding page (create org or accept invite)
    - Create `src/app/(auth)/onboarding/page.tsx`
    - Form to create new Organization (name, slug) or enter invite code
    - Server Action to process org creation or invite acceptance
    - Redirect to dashboard on completion
    - _Requirements: 2.3_

- [x] 5. Lead management and pipeline
  - [x] 5.1 Implement lead service (CRUD with soft-delete)
    - Create `src/server/services/leads.ts`
    - `createLead(data, userId, orgId)`: validate with Zod, persist with auto-injected orgId, trigger assignment rules if no assignee
    - `updateLead(id, data, userId)`: validate changed fields, verify org ownership
    - `softDeleteLead(id, userId)`: set deletedAt timestamp (idempotent — don't change if already deleted)
    - `moveLead(id, toStageId)`: create StageTransition, update stageId, set isClosed/closeDate for terminal stages (isClosedWon/isClosedLost), clear isClosed when moving back to open stage
    - `convertToContact(id)`: create Contact from lead data, move to Closed Won, link contact, exit active cadence enrollments
    - `getLeads(filters, pagination, accessFilter)`: exclude soft-deleted, apply RBAC filter
    - `getLeadById(id, accessFilter)`: single lead with relations
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 29.1, 29.2, 29.3, 29.4, 29.5, 34.3, 34.4_

  - [x] 5.2 Implement pipeline and stage service
    - Create `src/server/services/pipeline.ts`
    - `getOrCreateDefaultPipeline(orgId)`: auto-create "Sales Pipeline" with 6 default stages (New, Qualified, Demoed, Sent Proposal, Closed Won [isClosedWon=true], Closed Lost [isClosedLost=true]) on first lead
    - `reorderStages(pipelineId, stageIds)`: update stage orders as contiguous integers
    - `createStageTransition(leadId, fromStageId, toStageId, userId)`: record transition
    - _Requirements: 4.5, 17.2, 17.3, 34.1, 34.2_

  - [x] 5.3 Write property tests for lead management
    - **Property: Soft-deleted leads never appear in any listing or aggregate query**
    - **Property: Creating a lead then fetching by ID returns identical field values (round-trip)**
    - **Property: Soft-deleting an already-deleted lead does not change deletedAt (idempotence)**
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [x] 5.4 Write property tests for stage reordering
    - **Property: Stage reorder preserves all stages (no stages lost or duplicated)**
    - **Property: Stage orders are always contiguous integers starting from 1**
    - **Validates: Requirements 17.3, 17.4**

  - [x] 5.5 Create lead API route handlers
    - Create `src/app/api/leads/route.ts` — GET (list with pagination + RBAC filter), POST (create)
    - Create `src/app/api/leads/[id]/route.ts` — GET (detail), PATCH (update), DELETE (soft-delete)
    - Create `src/app/api/leads/[id]/move/route.ts` — PATCH (move to stage, set isClosed/closeDate for terminal stages)
    - Create `src/app/api/leads/[id]/convert/route.ts` — POST (convert lead to contact)
    - Apply requireSession, requirePermission, Zod validation, error handling pattern
    - _Requirements: 4.1, 4.2, 4.3, 29.1, 29.2, 29.3, 29.4, 34.3_

  - [x] 5.6 Create lead Server Actions
    - Create `src/server/actions/leads.ts`
    - `createLead(formData)`, `updateLead(formData)`, `deleteLead(id)` Server Actions
    - Include audit logging (async, non-blocking) for each mutation
    - Call `revalidatePath('/leads')` after mutations
    - _Requirements: 4.1, 4.2, 4.3, 20.1_

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Activity timeline and task management
  - [x] 7.1 Implement activity service
    - Create `src/server/services/activities.ts`
    - `createActivity(data, userId, orgId)`: validate with Zod, persist, update lead's lastActivityAt
    - `getActivitiesByLead(leadId, orgId)`: return sorted by createdAt descending
    - Support types: CALL (callDate, callDuration), MEETING (meetingDate, attendees), NOTE, EMAIL, FILE_ATTACHMENT
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.2 Write property tests for activity timeline
    - **Property: Activity list is always sorted by createdAt descending**
    - **Property: Adding an activity increases activity count by exactly 1**
    - **Property: lastActivityAt equals the most recent activity's createdAt**
    - **Validates: Requirements 5.1, 5.3, 5.4**

  - [x] 7.3 Implement task service
    - Create `src/server/services/tasks.ts`
    - `createTask(data, userId, orgId)`: validate with Zod (title, dueDate, leadId, assigneeId required)
    - `completeTask(id, userId)`: set isComplete=true, completedAt=now(), log Activity on lead
    - `reassignTask(id, newAssigneeId)`: validate new assignee exists, update assigneeId
    - `getTasks(userId, filters)`: sorted by dueDate ascending, highlight overdue
    - Support priorities: LOW, MEDIUM, HIGH
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [x] 7.4 Write property tests for task management
    - **Property: Completed tasks always have non-null completedAt**
    - **Property: Marking a task complete does not change any other task's state**
    - **Property: Task list is always sorted by dueDate ascending**
    - **Validates: Requirements 18.1, 18.3, 18.4**

  - [x] 7.5 Create activity and task API route handlers
    - Create `src/app/api/activities/route.ts` — POST (log activity)
    - Create `src/app/api/activities/[leadId]/route.ts` — GET (lead activities)
    - Create `src/app/api/tasks/route.ts` — GET (list), POST (create)
    - Create `src/app/api/tasks/[id]/route.ts` — PATCH (update/complete)
    - _Requirements: 5.1, 18.1_

  - [x] 7.6 Create task Server Actions
    - Create `src/server/actions/tasks.ts`
    - `createTask(formData)`, `completeTask(id)`, `updateTask(formData)` Server Actions
    - Include audit logging
    - _Requirements: 18.1, 18.3_


- [x] 8. Cadence engine
  - [x] 8.1 Implement cadence service (lifecycle management)
    - Create `src/server/services/cadences.ts`
    - `createCadence(data, userId, orgId)`: create with status DRAFT
    - `activateCadence(id)`: require at least one step exists, set status ACTIVE
    - `archiveCadence(id)`: exit all ACTIVE enrollments with reason "cadence_archived", set status ARCHIVED
    - `addStep(cadenceId, data)`: validate cadence not ARCHIVED, add step with contiguous order
    - `reorderSteps(cadenceId, stepIds)`: reorder maintaining contiguous integers from 1
    - Reject step modifications on ARCHIVED cadences
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.10_

  - [x] 8.2 Implement cadence enrollment service
    - `enrollLead(cadenceId, leadId, userId)`: check no duplicate ACTIVE enrollment, create with status ACTIVE and currentStepOrder 1
    - `bulkEnroll(cadenceId, leadIds, userId)`: enroll multiple leads (same validations per lead)
    - `pauseEnrollment(enrollmentId, userId)`: validate ACTIVE, set PAUSED, cancel pending jobs
    - `resumeEnrollment(enrollmentId, userId)`: validate PAUSED, set ACTIVE, schedule next step
    - `exitEnrollment(enrollmentId, reason)`: set status EXITED with exit reason
    - `completeEnrollment(enrollmentId)`: set status COMPLETED after final step
    - Handle conditional exits: reply_received, meeting_booked
    - _Requirements: 6.5, 6.6, 6.8, 6.9, 32.1, 32.2, 32.3_

  - [x] 8.3 Implement cadence analytics service
    - `getCadenceAnalytics(cadenceId)`: compute total enrollments, active/completed/exited counts, completion rate, avg completion time, per-step metrics (reached, completed, exited)
    - _Requirements: 32.5_

  - [x] 8.4 Implement cadence delete
    - `deleteCadence(id)`: reject if active enrollments exist, otherwise delete all related enrollments, steps, execution logs, then cadence
    - _Requirements: 32.4_

  - [x] 8.5 Write property tests for cadence state machine
    - **Property: A cadence always starts in DRAFT status**
    - **Property: No duplicate ACTIVE enrollments for same lead+cadence pair**
    - **Property: Archiving a cadence reduces active enrollment count to zero**
    - **Property: Step reorder preserves complete set of steps (no loss or duplication)**
    - **Property: Step orders are always contiguous integers starting from 1**
    - **Property: Only ACTIVE enrollments can be paused; only PAUSED can be resumed**
    - **Property: Cadences with active enrollments cannot be deleted**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 32.1, 32.2, 32.4**

  - [x] 8.6 Implement Inngest cadence step execution function
    - Create `src/server/inngest/client.ts` — Inngest client instance
    - Create `src/server/inngest/cadence-step.ts` — durable function with retries: 3
    - Verify enrollment is still ACTIVE (no-op if not)
    - Check conditional exits (reply/meeting)
    - Execute step action (EMAIL, CALL, LINKEDIN, MANUAL_TASK)
    - Create StepExecutionLog entry with outcome
    - Advance enrollment or complete if final step
    - Schedule next step with configurable delay
    - _Requirements: 6.7, 6.8, 14.1, 14.6_

  - [x] 8.7 Create cadence API route handlers and Server Actions
    - Create `src/app/api/cadences/route.ts` — GET (list), POST (create)
    - Create `src/app/api/cadences/[id]/route.ts` — GET (detail), PATCH (update), DELETE (delete with active enrollment check)
    - Create `src/app/api/cadences/[id]/activate/route.ts` — PATCH (activate)
    - Create `src/app/api/cadences/[id]/enroll/route.ts` — POST (enroll lead)
    - Create `src/app/api/cadences/[id]/bulk-enroll/route.ts` — POST (bulk enroll)
    - Create `src/app/api/cadences/[id]/analytics/route.ts` — GET (cadence analytics)
    - Create `src/app/api/cadences/enrollments/[id]/pause/route.ts` — PATCH (pause)
    - Create `src/app/api/cadences/enrollments/[id]/resume/route.ts` — PATCH (resume)
    - Create `src/app/api/cadences/enrollments/[id]/exit/route.ts` — PATCH (exit)
    - Create `src/server/actions/cadences.ts` — Server Actions for form-based mutations
    - _Requirements: 6.1, 6.2, 6.5, 32.1, 32.2, 32.3, 32.4, 32.5_

- [x] 9. Email integration (Gmail OAuth)
  - [x] 9.1 Implement OAuth token encryption utilities
    - Create `src/lib/encryption.ts` — AES-256-CBC encrypt/decrypt functions
    - Use random IV per encryption, store as `iv:ciphertext` hex format
    - Key sourced from validated env.EMAIL_ENCRYPTION_KEY (32 bytes hex)
    - _Requirements: 7.1_

  - [x] 9.2 Write property tests for encryption round-trip
    - **Property: Encrypting then decrypting any string returns the original value**
    - **Property: Two encryptions of the same plaintext produce different ciphertexts (random IV)**
    - **Validates: Requirements 7.1**

  - [x] 9.3 Implement email service (connect, send, personalization)
    - Create `src/server/services/email.ts`
    - `connectGmail(code, userId, orgId)`: exchange OAuth code for tokens, encrypt and store
    - `sendEmail(leadId, subject, body, userId)`: replace personalization tags, wrap HTML, send via Gmail API, create EmailMessage record
    - `refreshTokenIfNeeded(accountId)`: auto-refresh with 5-minute buffer
    - Personalization tags: {{FirstName}}, {{LastName}}, {{FullName}}, {{CompanyName}}, {{Title}}
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 9.4 Write property tests for email personalization
    - **Property: All personalization tags in a sent email are replaced (no raw {{Tag}} in output)**
    - **Property: Token refresh with still-valid token does not change stored token (idempotence)**
    - **Validates: Requirements 7.2, 7.5**

  - [x] 9.5 Implement Inngest email sync function
    - Create `src/server/inngest/email-sync.ts` — on-demand sync triggered by `email/sync.requested` event
    - Fetch emails from Gmail API, create EmailMessage records, link to leads by email address
    - _Requirements: 7.6, 14.2_

  - [x] 9.6 Create email API route handlers
    - Create `src/app/api/email/connect/route.ts` — POST (start Gmail OAuth)
    - Create `src/app/api/email/send/route.ts` — POST (send email with personalization)
    - _Requirements: 7.1, 7.2_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Lead scoring, assignment, and rhythm engine
  - [x] 11.1 Implement lead scoring service
    - Create `src/server/services/scoring.ts`
    - `calculateScore(leadId, orgId)`: compute score (0-100) based on configurable rules (activity count, deal value, stage progression, email engagement)
    - `recordScoreChange(leadId, previousScore, newScore, reason)`: create ScoreHistory entry
    - Always clamp scores to [0, 100]
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 11.2 Implement assignment rule engine
    - Create `src/server/services/assignment.ts`
    - `evaluateAssignmentRules(lead, orgId)`: evaluate rules in priority order (lowest number first)
    - Support rule types: TERRITORY (company/region match), DEAL_SIZE (min/max range), ROUND_ROBIN (Upstash Redis counter)
    - Skip evaluation entirely if lead already has assignee
    - Leave unassigned if no rule matches
    - _Requirements: 16.4, 16.5, 16.6_

  - [x] 11.3 Write property tests for scoring and assignment
    - **Property: Lead score is always in range [0, 100] after any calculation**
    - **Property: Assignment rules are evaluated in ascending priority order**
    - **Property: Round-robin distribution produces even allocation**
    - **Property: Adding an activity to a lead never decreases its score**
    - **Validates: Requirements 16.1, 16.3, 16.4, 16.5**

  - [x] 11.4 Implement Inngest score decay function
    - Create `src/server/inngest/score-decay.ts` — daily cron at midnight UTC
    - Find leads inactive beyond configured threshold, reduce scores by configured amount
    - Create ScoreHistory entries for each decay
    - Idempotent: running twice in same day produces same result
    - _Requirements: 14.3, 16.1_

  - [x] 11.5 Implement rhythm engine (priority scoring)
    - Create `src/server/services/rhythm.ts`
    - `calculatePriorityScore(action)`: weighted signals — overdue (+2/hr, max 30), deal value (+1/$5K, max 20), lead score (+1/5pts above 50), inactivity (+1/day over 7, max 15), HIGH priority (+10) — clamp to [1, 100]
    - `calculateDealEngagementScore(leadId)`: Activity Recency (0-25), Stakeholder Count (0-20), Activity Volume (0-20), Deal Progression (0-20), Lead Score (0-15) — clamp to [1, 100]
    - `classifyDealHealth(score)`: Healthy (60+), At Risk (35-59), Critical (<35)
    - `identifyDealGaps(leadId)`: no activity 7+ days, no future meeting, single-threaded (skip if meeting + recent activity)
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6_

  - [x] 11.6 Write property tests for rhythm engine
    - **Property: Priority score is always clamped to [1, 100]**
    - **Property: Deal Engagement Score is always clamped to [1, 100]**
    - **Property: Increasing deal value never decreases priority score**
    - **Property: Same inputs in any order produce same priority score (confluence)**
    - **Validates: Requirements 9.1, 9.4**

  - [x] 11.7 Implement Inngest task reminder function
    - Create `src/server/inngest/task-reminder.ts` — hourly cron
    - Find tasks due within 24 hours, flag them in rhythm dashboard
    - _Requirements: 14.4_


- [x] 12. AI features (email generation, account research, chatbot)
  - [x] 12.1 Implement AI service
    - Create `src/server/services/ai.ts`
    - `generateEmail(leadId, userId, orgId)`: send lead context (name, title, company, last 5 interactions) + active system prompt to Gemini API, return structured {subject, body}
    - `researchAccount(companyId, orgId)`: send company details, return structured intelligence (executive summary, strategic goals, sales angles, challenges)
    - `chatMessage(message, userId, orgId)`: process chatbot message with context, return response
    - Error handling: return generic "AI service temporarily unavailable" on failure — never expose API keys or internals
    - Only include admin-configured system prompts when active
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 12.2 Write property tests for AI error handling
    - **Property: AI failures never expose API keys or internal system details in response**
    - **Property: AI requests always include admin-configured system prompt when active**
    - **Validates: Requirements 8.5, 8.4**

  - [x] 12.3 Create AI API route handlers
    - Create `src/app/api/ai/generate-email/route.ts` — POST
    - Create `src/app/api/ai/research/route.ts` — POST
    - Create `src/app/api/ai/chat/route.ts` — POST
    - Apply session + permission checks, Zod validation
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 13. Revenue forecasting
  - [x] 13.1 Implement forecast service
    - Create `src/server/services/forecast.ts`
    - `calculatePipelineMetrics(orgId)`: total pipeline value, weighted pipeline (value × stage win probability), AI predicted (70% weighted + 30% monthly run rate)
    - `submitForecast(userId, orgId, period, commitAmount)`: store commit for YYYY-MM period
    - `assessForecastRisk(teamCommit, aiPredicted)`: On Track (<15% gap), At Risk (15-30%), High Risk (>30%)
    - `calculateWinRate(orgId)`: last 90 days closed deals, capped at 100%
    - _Requirements: 10.1, 10.2, 10.3, 10.5_

  - [x] 13.2 Write property tests for forecasting
    - **Property: Weighted pipeline is always ≤ total pipeline value**
    - **Property: AI predicted is always positive when pipeline has open deals**
    - **Property: Adding a deal never decreases total pipeline value**
    - **Validates: Requirements 10.1, 10.3**

  - [x] 13.3 Implement Inngest forecast snapshot function
    - Create `src/server/inngest/forecast-snapshot.ts` — daily cron at 01:00 UTC
    - Create ForecastSnapshot with pipeline metrics for trend tracking
    - _Requirements: 10.4, 14.5_

  - [x] 13.4 Create forecast API route handlers
    - Create `src/app/api/forecast/route.ts` — GET (forecast data)
    - Create `src/app/api/forecast/submit/route.ts` — POST (submit forecast)
    - Create `src/app/api/forecast/compare/route.ts` — GET (commit vs AI comparison with risk level, confidence interval, snapshots)
    - Apply session + forecast:read/forecast:submit permissions
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 14. CSV import/export
  - [x] 14.1 Implement CSV import service
    - Create `src/server/services/csv.ts`
    - `parseCSV(file)`: parse headers, detect row count, return preview
    - `previewImport(csvContent, fieldMapping)`: apply mapping to first 5 rows, return preview
    - `importLeads(rows, mapping, userId, orgId)`: validate each row (firstName, lastName, stage required), run duplicate detection per row (skip duplicates), create companies as needed, create leads with stage transitions, link contacts — guarantee all-or-nothing per valid row
    - Skip invalid rows with error reason
    - Report: successCount + skipCount = totalRows
    - Create audit entry for each imported lead
    - `saveFieldMapping(name, mapping, userId, orgId)`: persist reusable field mapping
    - `getFieldMappings(orgId)`: list saved field mappings
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 27.7_

  - [x] 14.2 Implement CSV export service
    - `exportLeads(filters, orgId)`: generate CSV excluding soft-deleted leads
    - Apply RBAC access filter to exported data
    - _Requirements: 11.6_

  - [x] 14.3 Write property tests for CSV import
    - **Property: successCount + skipCount always equals totalRows**
    - **Property: Importing N valid rows increases lead count by exactly N**
    - **Property: Invalid rows are skipped without affecting valid row processing**
    - **Validates: Requirements 11.2, 11.5, 11.6**

  - [x] 14.4 Create CSV API route handlers
    - Create `src/app/api/csv/import/route.ts` — POST (upload + import)
    - Create `src/app/api/csv/export/route.ts` — GET (download CSV)
    - _Requirements: 11.1, 11.6_

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Full-text search
  - [x] 16.1 Implement search service with tsvector
    - Create `src/server/services/search.ts`
    - Set up tsvector fields on Lead, Contact, Company models (via Prisma raw SQL or migration)
    - Create GIN indexes for full-text search performance
    - `search(query, orgId, filters)`: return ranked results across Lead, Contact, Company
    - Exclude soft-deleted leads from results
    - Support filtering by entity type, date range, assigned user
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 16.2 Write property tests for search
    - **Property: Soft-deleted leads never appear in search results**
    - **Property: Same query returns same results given no data changes (idempotence)**
    - **Validates: Requirements 12.3, 12.4**

  - [x] 16.3 Create search API route handler
    - Create `src/app/api/search/route.ts` — GET (full-text search with filters)
    - _Requirements: 12.2_

- [x] 17. File storage
  - [x] 17.1 Implement file storage service
    - Create `src/server/services/storage.ts`
    - `uploadFile(file, leadId, activityId, orgId)`: validate size (≤25MB) and MIME type, store in Supabase Storage at `attachments/{orgId}/{leadId}/{filename}`, create FileAttachment record
    - `getSignedUrl(fileId, userId)`: verify RBAC access, generate short-expiration signed URL
    - Enforce RLS policies on storage bucket
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 17.2 Write property tests for file storage
    - **Property: Files exceeding 25 MB are always rejected with descriptive error**
    - **Property: File access respects same RBAC rules as lead access**
    - **Validates: Requirements 13.3, 13.4**

  - [x] 17.3 Create upload API route handler
    - Create `src/app/api/upload/route.ts` — POST (file upload)
    - Validate file size and MIME type before processing
    - _Requirements: 13.1, 13.4_

- [x] 18. Audit logging and GDPR
  - [x] 18.1 Implement audit logging service
    - Create `src/server/services/audit.ts`
    - `auditLog(entry)`: async, non-blocking — create AuditEntry with userId, action, entityType, entityId, changes (old/new for updates)
    - Entries are immutable — no update/delete operations
    - `getAuditLog(orgId, filters)`: filterable by entity type, user, date range
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 18.2 Write property tests for audit logging
    - **Property: Audit entries are immutable (never modified after creation)**
    - **Property: Every successful CUD operation produces exactly one audit entry**
    - **Validates: Requirements 20.1, 20.4**

  - [x] 18.3 Implement deletion request workflow service
    - Create `src/server/services/deletion.ts`
    - `requestDeletion(userId, input)`: create DeletionRequest with status "pending" (reject if duplicate pending exists)
    - `listPendingRequests(orgId)`: list pending requests for managers/admins
    - `approveRequest(requestId, reviewerId)`: execute deletion (soft-delete for leads, hard delete for contacts/tasks), mark as "approved"
    - `rejectRequest(requestId, reviewerId)`: mark as "rejected" without executing deletion
    - `canDirectDelete(userRole)`: returns true for MANAGER/ADMIN (skip request workflow)
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.6_

- [x] 19. Inngest serve endpoint and function registry
  - [x] 19.1 Create Inngest serve endpoint and register all functions
    - Create `src/app/api/inngest/route.ts` — serve endpoint with GET, POST, PUT handlers
    - Register all functions: cadenceStepFunction, emailSyncFunction, scoreDecayFunction, taskReminderFunction, forecastSnapshotFunction
    - Configure retry policy (3 retries with exponential backoff)
    - _Requirements: 14.6, 14.7_

- [x] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. UI components and pages — Dashboard shell and layout
  - [x] 21.1 Create root layout with providers
    - Create `src/app/layout.tsx` — root layout with TanStack Query provider, Zustand stores, global CSS
    - Create `src/components/providers.tsx` — QueryClientProvider wrapper
    - _Requirements: 26.3, 26.4_

  - [x] 21.2 Create dashboard shell layout (sidebar + header)
    - Create `src/app/(dashboard)/layout.tsx` — authenticated layout with session check
    - Create `src/components/layout/shell.tsx` — main shell with sidebar and header
    - Create `src/components/layout/sidebar.tsx` — navigation with permission-based item filtering
    - Create `src/components/layout/header.tsx` — top bar with user menu
    - Create `src/stores/layout.ts` — Zustand store for sidebar collapse, chatbot visibility
    - _Requirements: 3.7, 26.4, 26.5_

  - [x] 21.3 Create dashboard home page
    - Create `src/app/(dashboard)/page.tsx` — dashboard with tabbed view: Today's Rhythm, Team View (Manager), Deal Health, Deal Gaps, Forecast, Commit vs AI (Manager), Pipeline Metrics
    - Server Component fetching data via Prisma with tenant scope
    - Pipeline Metrics tab: pipeline value per stage, conversion rates, stage duration, lead counts, closed summary (with date range filter)
    - _Requirements: 9.3, 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7_

- [x] 22. UI components — Lead management pages
  - [x] 22.1 Create leads list page with filters
    - Create `src/app/(dashboard)/leads/page.tsx` — Server Component with lead listing
    - Create `src/components/leads/lead-table.tsx` — data table with sorting, filtering
    - Create `src/components/leads/lead-filters.tsx` — filter controls (status, stage, assignee)
    - Create `src/hooks/use-leads.ts` — TanStack Query hooks for lead data
    - Create `src/stores/filters.ts` — Zustand store for filter state
    - _Requirements: 4.4, 4.6_

  - [x] 22.2 Create lead detail page with activity timeline
    - Create `src/app/(dashboard)/leads/[id]/page.tsx` — lead detail Server Component
    - Create `src/components/leads/lead-detail.tsx` — lead info display/edit
    - Create `src/components/leads/lead-convert.tsx` — convert to contact button with confirmation
    - Create `src/components/activities/activity-timeline.tsx` — chronological activity list
    - Create `src/components/activities/activity-form.tsx` — log new activity form
    - Create `src/components/rhythm/conversation-intelligence.tsx` — AI meeting summaries per lead
    - Create `src/components/rhythm/coaching-comments.tsx` — coaching comment thread on activities
    - Create `src/hooks/use-activities.ts` — TanStack Query hooks for activities
    - _Requirements: 5.1, 5.2, 5.4, 29.1, 30.1, 31.1, 31.3_

  - [x] 22.3 Create lead create/edit forms
    - Create `src/components/leads/lead-form.tsx` — Zod-validated form with all lead fields
    - Wire to Server Actions for create/update
    - _Requirements: 4.1, 4.2, 4.6_

- [x] 23. UI components — Pipeline Kanban board
  - [x] 23.1 Create Kanban board page
    - Create `src/app/(dashboard)/pipeline/page.tsx` — pipeline view
    - Create `src/components/pipeline/kanban-board.tsx` — drag-and-drop board with stage columns
    - Create `src/components/pipeline/kanban-card.tsx` — lead card showing deal value + score
    - Create `src/stores/kanban.ts` — Zustand store for drag state
    - MEMBER view: only assigned leads; empty board shows all stage columns
    - _Requirements: 17.1, 17.2, 17.4, 17.5_

- [x] 24. UI components — Cadence builder
  - [x] 24.1 Create cadence management pages
    - Create `src/app/(dashboard)/cadences/page.tsx` — cadence list with metrics (step count, active/completed enrollments, completion rate)
    - Create `src/app/(dashboard)/cadences/[id]/page.tsx` — cadence detail with 4 tabs: Overview, People (enrollments), Analytics, Settings
    - Create `src/components/cadences/cadence-builder.tsx` — step editor with drag-to-reorder
    - Create `src/components/cadences/enrollment-list.tsx` — enrolled leads with pause/resume/exit actions
    - Create `src/components/cadences/cadence-analytics.tsx` — enrollment counts, completion rate, avg time, per-step metrics
    - Create `src/components/cadences/enroll-dialog.tsx` — enroll lead(s) dialog with bulk support
    - Create `src/hooks/use-cadences.ts` — TanStack Query hooks
    - _Requirements: 6.1, 6.2, 6.5, 6.10, 32.1, 32.2, 32.3, 32.5_

- [x] 25. UI components — Tasks, Rhythm, and Forecast
  - [x] 25.1 Create task management page
    - Create `src/app/(dashboard)/tasks/page.tsx` — task list sorted by dueDate
    - Create `src/components/tasks/task-list.tsx` — task items with overdue highlighting
    - Create `src/components/tasks/task-form.tsx` — create/edit task form
    - _Requirements: 18.1, 18.4_

  - [x] 25.2 Create rhythm dashboard
    - Create `src/app/(dashboard)/rhythm/page.tsx` — priority-sorted action list
    - Create `src/components/rhythm/priority-list.tsx` — actions sorted by priority score
    - Create `src/components/rhythm/deal-health.tsx` — deal engagement scores + health classification
    - Manager view: team aggregation with overdue counts and top 3 urgent per rep
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 25.3 Create forecast page
    - Create `src/app/(dashboard)/forecast/page.tsx` — pipeline forecasting
    - Create `src/components/forecast/forecast-panel.tsx` — total/weighted/AI predicted metrics
    - Create `src/components/forecast/commit-form.tsx` — submit forecast form
    - Create `src/components/forecast/risk-indicator.tsx` — On Track/At Risk/High Risk display
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 26. UI components — Search, CSV, Email, AI, Settings
  - [x] 26.1 Create search interface
    - Create `src/app/(dashboard)/search/page.tsx` — search results page
    - Create `src/components/search/search-bar.tsx` — global search input
    - Create `src/components/search/search-results.tsx` — ranked results across entity types
    - _Requirements: 12.2, 12.4_

  - [x] 26.2 Create CSV import/export pages
    - Create `src/app/(dashboard)/csv/page.tsx` — import/export interface
    - Create `src/components/csv/import-wizard.tsx` — file upload, column mapping, validation preview
    - Create `src/components/csv/export-button.tsx` — export trigger
    - _Requirements: 11.1, 11.6_

  - [x] 26.3 Create email compose and Gmail connect UI
    - Create `src/components/email/email-compose.tsx` — compose with personalization tag insertion
    - Create `src/components/email/gmail-connect.tsx` — OAuth connection flow
    - Create `src/components/email/email-thread.tsx` — threaded email view
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 26.4 Create AI chatbot sidebar and email generation UI
    - Create `src/components/ai/chatbot-sidebar.tsx` — persistent sidebar accessible from every page
    - Create `src/components/ai/email-generator.tsx` — AI email draft interface
    - Create `src/components/ai/account-research.tsx` — AI research results display
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 26.5 Create settings and admin pages
    - Create `src/app/(dashboard)/settings/page.tsx` — organization settings
    - Create `src/app/(dashboard)/admin/page.tsx` — user management, audit log
    - Create `src/components/admin/audit-log.tsx` — filterable audit trail (empty state when no entries)
    - Create `src/components/admin/user-management.tsx` — invite users, manage roles
    - Create `src/components/admin/team-management.tsx` — team hierarchy CRUD
    - Create `src/components/admin/deletion-requests.tsx` — pending deletion request review (approve/reject)
    - Create `src/components/admin/assignment-rules.tsx` — assignment rule configuration
    - Create `src/components/scoring/scoring-rules.tsx` — scoring rule CRUD
    - Create `src/components/scoring/score-decay-config.tsx` — decay configuration
    - Create `src/components/ai/ai-prompt-config.tsx` — AI prompt configuration (admin)
    - _Requirements: 2.11, 3.7, 20.3, 33.6_

- [x] 27. Contacts and companies
  - [x] 27.1 Implement contacts and companies service
    - Create `src/server/services/contacts.ts`
    - `createContact(data, orgId)`: validate with Zod (firstName, lastName required)
    - `createCompany(data, orgId)`: validate with Zod (name required)
    - `linkContactToLead(contactId, leadId)`: create LeadContact join record
    - `linkLeadToCompany(leadId, companyId)`: update lead's companyId
    - Maintain tsvector search fields on Contact and Company
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 27.2 Create contacts and companies pages
    - Create `src/app/(dashboard)/contacts/page.tsx` — contact list
    - Create `src/app/(dashboard)/companies/page.tsx` — company list
    - Create corresponding components for CRUD operations
    - _Requirements: 19.1, 19.3_

- [x] 28. Duplicate detection and lead merge
  - [x] 28.1 Implement duplicate detection service
    - Create `src/server/services/duplicates.ts`
    - `checkDuplicates(contactEmail?, companyName?, orgId)`: search by email (case-insensitive) and/or company name (case-insensitive), return matches with leadId, leadName, matchType, matchValue
    - `mergeLeads(primaryLeadId, secondaryLeadId, orgId)`: move activities and contacts from secondary to primary (skip existing links), delete secondary lead — all in a transaction
    - Reject self-merge (primaryLeadId === secondaryLeadId)
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6_

  - [x] 28.2 Write property tests for duplicate detection and merge
    - **Property: After merge, primary lead has union of both leads' activities**
    - **Property: No duplicate LeadContact records exist after merge**
    - **Property: Self-merge always returns an error**
    - **Validates: Requirements 27.3, 27.4, 27.6**

  - [x] 28.3 Create duplicate detection API route handlers
    - Create `src/app/api/duplicates/check/route.ts` — POST (check for duplicates)
    - Create `src/app/api/leads/[id]/merge/route.ts` — POST (merge secondary into primary)
    - _Requirements: 27.1, 27.3_

- [x] 29. Dashboard analytics service
  - [x] 29.1 Implement dashboard analytics service
    - Create `src/server/services/dashboard.ts`
    - `getPipelineValue(orgId, dateRange?)`: total deal value per stage
    - `getConversionRates(orgId, dateRange?)`: stage-to-stage conversion rates
    - `getStageDuration(orgId, dateRange?)`: average time in each stage
    - `getLeadCounts(orgId, dateRange?)`: lead count per stage
    - `getClosedSummary(orgId, dateRange?)`: closed won/lost counts
    - All metrics support date range filtering and are scoped to organization
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6_

  - [x] 29.2 Create dashboard analytics API route handlers
    - Create `src/app/api/dashboard/pipeline-value/route.ts` — GET
    - Create `src/app/api/dashboard/conversion-rates/route.ts` — GET
    - Create `src/app/api/dashboard/stage-duration/route.ts` — GET
    - Create `src/app/api/dashboard/lead-counts/route.ts` — GET
    - Create `src/app/api/dashboard/closed-summary/route.ts` — GET
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5_

- [x] 30. Coaching comments and conversation intelligence
  - [x] 30.1 Implement coaching comments service
    - Create `src/server/services/coaching.ts`
    - `addComment(activityId, authorId, content, mentionedUserId?, orgId)`: create CoachingComment
    - `getComments(activityId, orgId)`: list comments sorted by createdAt ascending
    - MEMBER access: only see comments on their own activities
    - _Requirements: 30.1, 30.2, 30.3, 30.4_

  - [x] 30.2 Implement conversation intelligence service
    - Add to `src/server/services/ai.ts`
    - `summarizeMeeting(activityId, orgId)`: send meeting data to AI, return structured summary (aiSummary, keyTopics, actionItems, sentiment, trackers), store on activity
    - `getLeadConversations(leadId, orgId)`: list all meeting summaries for a lead
    - Return stored summary if already generated (idempotent)
    - _Requirements: 31.1, 31.2, 31.3, 31.4_

  - [x] 30.3 Create coaching and conversation API route handlers
    - Create `src/app/api/rhythm/coaching/[activityId]/route.ts` — GET (list), POST (add comment)
    - Create `src/app/api/rhythm/conversations/[activityId]/summarize/route.ts` — POST
    - Create `src/app/api/rhythm/conversations/lead/[leadId]/route.ts` — GET
    - _Requirements: 30.1, 31.1, 31.3_

- [x] 31. Deletion request workflow
  - [x] 31.1 Create deletion request API route handlers
    - Create `src/app/api/deletion-requests/route.ts` — GET (list), POST (create request)
    - Create `src/app/api/deletion-requests/[id]/approve/route.ts` — PATCH
    - Create `src/app/api/deletion-requests/[id]/reject/route.ts` — PATCH
    - _Requirements: 33.1, 33.3, 33.4, 33.6_

- [x] 32. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 33. CI/CD pipeline and deployment configuration
  - [x] 33.1 Create GitHub Actions CI workflow
    - Create `.github/workflows/ci.yml`
    - Run TypeScript strict check (`tsc --noEmit`)
    - Run full test suite (`vitest --run`)
    - On push to main: run Supabase CLI migrations before deploy
    - Fail build on TypeScript errors
    - _Requirements: 23.1, 23.2, 23.5, 24.1_

  - [x] 33.2 Create Vercel deployment configuration
    - Create `vercel.json` with build command (`prisma generate && next build`), install command
    - Configure API route Cache-Control headers (no-store)
    - Set up environment variable references
    - _Requirements: 23.3, 23.4_

  - [x] 33.3 Create Prisma seed script
    - Create `prisma/seed.ts` — seed default roles (OWNER, ADMIN, MANAGER, MEMBER with permissions), dev users, default pipeline
    - _Requirements: 2.6 (default roles)_

- [x] 34. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the requirements document
- Unit tests validate specific examples and edge cases
- The design uses TypeScript throughout — all code examples use TypeScript/Next.js patterns
- Inngest functions are registered at a single serve endpoint (`/api/inngest`)
- All data access goes through the tenant-scoped Prisma client — no raw queries bypass isolation
- UI components use Shadcn/ui primitives with TailwindCSS v4 styling
- Server state is managed via TanStack Query v5; client UI state via Zustand v5
- Tasks 28–31 cover features that existed in the source app but were initially missed: duplicate detection/merge, dashboard analytics, coaching comments, conversation intelligence, and deletion request workflow

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.7"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["1.5", "1.8"] },
    { "id": 4, "tasks": ["1.6", "2.1"] },
    { "id": 5, "tasks": ["2.2", "2.7"] },
    { "id": 6, "tasks": ["2.3", "2.5", "2.6"] },
    { "id": 7, "tasks": ["2.4", "2.8"] },
    { "id": 8, "tasks": ["4.1", "4.2"] },
    { "id": 9, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 10, "tasks": ["5.1", "5.2"] },
    { "id": 11, "tasks": ["5.3", "5.4", "5.5", "5.6"] },
    { "id": 12, "tasks": ["7.1", "7.3"] },
    { "id": 13, "tasks": ["7.2", "7.4", "7.5", "7.6"] },
    { "id": 14, "tasks": ["8.1", "8.2", "8.3", "8.4"] },
    { "id": 15, "tasks": ["8.5", "8.6", "8.7"] },
    { "id": 16, "tasks": ["9.1", "9.3"] },
    { "id": 17, "tasks": ["9.2", "9.4", "9.5", "9.6"] },
    { "id": 18, "tasks": ["11.1", "11.2", "11.5"] },
    { "id": 19, "tasks": ["11.3", "11.4", "11.6", "11.7"] },
    { "id": 20, "tasks": ["12.1", "13.1"] },
    { "id": 21, "tasks": ["12.2", "12.3", "13.2", "13.3", "13.4"] },
    { "id": 22, "tasks": ["14.1", "14.2", "16.1"] },
    { "id": 23, "tasks": ["14.3", "14.4", "16.2", "16.3"] },
    { "id": 24, "tasks": ["17.1", "18.1", "18.3"] },
    { "id": 25, "tasks": ["17.2", "17.3", "18.2", "19.1"] },
    { "id": 26, "tasks": ["21.1", "21.2"] },
    { "id": 27, "tasks": ["21.3", "22.1", "22.2", "22.3"] },
    { "id": 28, "tasks": ["23.1", "24.1", "25.1", "25.2", "25.3"] },
    { "id": 29, "tasks": ["26.1", "26.2", "26.3", "26.4", "26.5"] },
    { "id": 30, "tasks": ["27.1", "27.2", "28.1", "29.1", "30.1", "30.2", "31.1"] },
    { "id": 31, "tasks": ["28.2", "28.3", "29.2", "30.3"] },
    { "id": 32, "tasks": ["33.1", "33.2", "33.3"] }
  ]
}
```
