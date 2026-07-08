# Requirements Document

## Introduction

This document specifies the requirements for **flowrish-next**, a greenfield rebuild of the Flowrish CRM as a single Next.js 15 application deployed to Vercel + Supabase. The rebuild consolidates a monorepo (Fastify backend + Vite React SPA) into a unified Next.js App Router application with Server Components, Server Actions, and Route Handlers. All existing features reach parity; no production data is migrated — the new system starts fresh with seed data only.

The application is designed as a **multi-tenant SaaS platform** where each Organization has isolated data, configurable team hierarchies, and flexible role-based permissions. This enables scaling to serve multiple companies from a single deployment.

## Glossary

- **App**: The flowrish-next Next.js 15 application
- **Organization**: A tenant entity representing a company or team using the platform — all data is scoped to an Organization
- **Team**: A group within an Organization that can have sub-teams (nested hierarchy) and members with role assignments
- **Auth_System**: Supabase Auth with cookie-based sessions (email magic link + Google OAuth)
- **Database**: Supabase Postgres accessed via Prisma v6 ORM with tenant isolation via organizationId
- **Job_System**: Inngest durable functions for background processing
- **Cache**: Upstash Redis for rate limiting, counters, and round-robin state
- **Storage**: Supabase Storage for file uploads with per-organization bucket isolation
- **Router**: Next.js App Router (Server Components, Server Actions, Route Handlers)
- **Validator**: Zod v3 schema validation layer
- **State_Manager**: TanStack Query v5 (server state) + Zustand v5 (client state)
- **Search_Engine**: PostgreSQL tsvector full-text search with GIN indexes (scoped per organization)
- **AI_Provider**: Google Gemini API via OpenAI-compatible endpoint
- **CI_Pipeline**: GitHub Actions for tests + Supabase CLI migrations
- **Deploy_Platform**: Vercel for builds and deployments (auto-deploy on push to main)

## Assumptions

1. Supabase project is provisioned with Postgres, Auth, and Storage enabled
2. Vercel project is connected to the flowrish-next GitHub repository
3. Inngest account is provisioned with a signing key and event key
4. Upstash Redis instance is provisioned with REST API credentials
5. Google Cloud project has OAuth 2.0 credentials configured for both auth and Gmail API
6. Gemini API key is provisioned for AI features
7. All dependencies are pinned to exact stable versions (no `^` or `~` ranges)
8. Next.js 15 with React 19 (latest stable as of May 2026)
9. The source repo (flowrish) will be archived after a 30-day grace period post-cutover
10. No production data migration — fresh database with seed data (dev users + default pipeline)
11. The application is multi-tenant — all data is scoped to an Organization with row-level isolation
12. Organizations can define custom team hierarchies (nested teams) and custom roles with granular permissions
13. Default roles are OWNER, ADMIN, MANAGER, MEMBER — organizations can extend with custom roles
14. Tenant isolation is enforced at the Prisma middleware level (server-side) — never relying on client-provided organizationId
15. The application is designed for multi-tenancy from day one — each organization is a fully isolated tenant

## Requirements

### Requirement 1: Authentication and Session Management

**User Story:** As a user, I want to sign in via email magic link or Google OAuth, so that I can securely access the CRM without managing passwords.

#### Acceptance Criteria

1. WHEN a user submits their email address, THE Auth_System SHALL send a magic link email and redirect the user to a confirmation page
2. WHEN a user clicks a valid magic link, THE Auth_System SHALL create a cookie-based session and redirect to the dashboard
3. WHEN a user initiates Google OAuth sign-in, THE Auth_System SHALL redirect to Google consent screen and on callback create a cookie-based session
4. WHEN a new user signs in via Google OAuth for the first time, THE Auth_System SHALL create a record in auth.users and trigger a database function that inserts a corresponding row in the app User table with role MEMBER — the user SHALL then be prompted to create a new Organization or accept a pending invite to join an existing one
5. WHEN a session cookie expires, is corrupted, is manually invalidated, or becomes invalid for any reason (including server-side session revocation), THE App SHALL clear the session state and redirect the user to the login page
6. THE Auth_System SHALL use Supabase SSR helpers (`@supabase/ssr`) to manage cookie-based sessions across Server Components, Server Actions, Route Handlers, and Middleware
7. IF a user attempts to access a protected route without a valid session, THEN THE App SHALL return a 401 response or redirect to login

#### Correctness Properties

- Round-trip: Creating a session then validating it returns the same user identity
- Invariant: A user record in the app User table always corresponds to exactly one auth.users entry
- Idempotence: Signing in multiple times with the same credentials produces the same session user

---

### Requirement 2: Multi-Tenancy and Organization Model

**User Story:** As a platform operator, I want the application to support multiple organizations with isolated data, so that different companies can use the same deployment without seeing each other's data.

#### Acceptance Criteria

1. THE App SHALL implement multi-tenancy at the organization level — every data record (leads, contacts, companies, activities, tasks, cadences, pipelines, etc.) SHALL belong to exactly one Organization via an `organizationId` foreign key
2. THE Database SHALL enforce tenant isolation via Prisma middleware that automatically injects `organizationId` into all queries and mutations — no cross-organization data leakage SHALL be possible regardless of user role
3. WHEN a new user signs up, THE App SHALL either create a new Organization (if signing up as an org owner) or join an existing Organization via an invite link
4. THE App SHALL support an Organization model with fields: id, name, slug (unique, URL-safe), plan, createdAt, updatedAt
5. THE App SHALL support a flexible team hierarchy within each Organization:
   - Organizations have one or more Teams
   - Each Team has a name, optional parent Team (enabling nested hierarchy), and members
   - Team membership includes a role assignment (OWNER, ADMIN, MANAGER, MEMBER — or custom roles defined by the org)
6. THE App SHALL enforce the following default role hierarchy within an Organization:
   - **OWNER**: Full organization access — billing, settings, user management, all data, can create/delete teams
   - **ADMIN**: Organization-wide data access, user management (except billing), team management
   - **MANAGER**: Access to all data within their team(s) and sub-teams, can manage team members and team-level settings (scoring rules, assignment rules, cadences, pipelines, AI prompts)
   - **MEMBER**: Access only to data assigned to them within their team(s)
7. THE App SHALL allow Organizations to define custom roles with granular permissions — each permission SHALL map to a specific capability (e.g., `leads:read`, `leads:write`, `cadences:manage`, `users:invite`, `billing:manage`)
8. WHEN a user belongs to multiple Teams within the same Organization, THE App SHALL grant the union of permissions from all team memberships
9. THE App SHALL scope all API queries by `organizationId` extracted from the authenticated user's session — no endpoint SHALL accept `organizationId` as a client-provided parameter (preventing tenant spoofing)
10. THE App SHALL include `organizationId` in all Supabase RLS policies for Storage buckets, ensuring file isolation between tenants
11. THE App SHALL support organization-level settings: default pipeline, scoring rules, assignment rules, AI prompt configs, and cadence templates — these settings SHALL NOT be visible to other organizations

#### Correctness Properties

- Invariant: Every data record belongs to exactly one Organization — no record exists without an organizationId
- Invariant: A user can never read or modify data belonging to an Organization they are not a member of
- Invariant: organizationId is always derived server-side from the session — never from client input
- Metamorphic: Adding a user to a Team never grants access to data in a different Organization
- Round-trip: Creating a record within an Organization then querying from a different Organization returns zero results

---

### Requirement 3: Role-Based Access Control

**User Story:** As an admin, I want to enforce role-based permissions within my organization, so that team members only access data and features appropriate to their role.

#### Acceptance Criteria

1. THE App SHALL enforce the default role hierarchy: OWNER > ADMIN > MANAGER > MEMBER with escalating permissions
2. WHILE a user has role MEMBER, THE App SHALL restrict lead access to only leads assigned to that user within their team(s)
3. WHILE a user has role MANAGER, THE App SHALL grant access to all leads within their team(s) and sub-teams, plus management features (scoring rules, assignment rules, cadences, pipelines, AI prompts, forecasting)
4. WHILE a user has role ADMIN, THE App SHALL grant access to all data within the Organization including user management and audit log
5. WHILE a user has role OWNER, THE App SHALL grant access to all features including billing, organization settings, and team creation/deletion
6. WHEN a MEMBER attempts a management operation, THE App SHALL reject the request with HTTP 403 immediately — role checks SHALL occur before any business logic processing to prevent partial execution
7. THE App SHALL filter navigation sidebar items based on the authenticated user's effective permissions (union of all team role permissions)
8. THE App SHALL support permission inheritance — a MANAGER of a parent team SHALL have MANAGER access to all sub-teams unless explicitly overridden
9. WHEN checking permissions, THE App SHALL evaluate: organization-level role → team-level role → custom permissions, with the highest privilege winning

#### Correctness Properties

- Invariant: MEMBER can never read or modify leads not assigned to them
- Invariant: No user can access data outside their Organization regardless of role
- Metamorphic: Adding a higher role never reduces accessible resources
- Error condition: All unauthorized access attempts produce exactly HTTP 403
- Invariant: Permission checks always complete before any business logic executes

---

### Requirement 4: Lead Management

**User Story:** As a sales rep, I want to create, view, update, and soft-delete leads, so that I can track prospects through the sales process.

#### Acceptance Criteria

1. WHEN a user creates a lead, THE App SHALL validate the input with Zod (requiring firstName, lastName, stageId) and persist the lead to the Database with the user's organizationId automatically injected
2. WHEN a user updates a lead, THE App SHALL validate all changed fields with Zod and persist the update — THE App SHALL verify the lead belongs to the user's Organization before allowing the update
3. WHEN a user deletes a lead, THE App SHALL set the `deletedAt` timestamp instead of removing the row
4. THE App SHALL exclude soft-deleted leads (where `deletedAt` is not null) from all listing, search, and metric queries
5. WHEN the first lead is created within an Organization and no pipeline exists for that Organization, THE App SHALL auto-create a default "Sales Pipeline" with 6 stages: New, Qualified, Demoed, Sent Proposal, Closed Won, Closed Lost
6. THE App SHALL store lead fields: firstName, lastName, email, altEmail, phone, title, description, dealValue, currency (default USD), score, leadStatus, tier, linkedinUrl, country, state, companyName, companyIndustry, companyWebsite

#### Correctness Properties

- Invariant: Soft-deleted leads never appear in any listing or aggregate query
- Round-trip: Creating a lead then fetching it by ID returns identical field values
- Idempotence: Soft-deleting an already-deleted lead does not change the deletedAt timestamp

---

### Requirement 5: Activity Timeline and Logging

**User Story:** As a sales rep, I want to log calls, meetings, notes, and emails against a lead, so that I have a complete interaction history.

#### Acceptance Criteria

1. WHEN a user logs an activity, THE App SHALL validate the input with Zod (requiring type, leadId) and persist the activity with a createdAt timestamp
2. THE App SHALL support activity types: CALL (with callDate, callDuration), MEETING (with meetingDate, attendees), NOTE, EMAIL, FILE_ATTACHMENT
3. WHEN an activity is created, THE App SHALL update the lead's `lastActivityAt` field to the current timestamp
4. THE App SHALL return activities for a lead sorted by createdAt descending (newest first)
5. WHEN an email activity is logged, THE App SHALL associate it with an EmailMessage record for threading support

#### Correctness Properties

- Invariant: Activity list for a lead is always sorted by createdAt descending
- Metamorphic: Adding an activity to a lead increases the activity count by exactly 1
- Invariant: lastActivityAt on a lead is always equal to the most recent activity's createdAt

---

### Requirement 6: Cadence Engine

**User Story:** As a manager, I want to create multi-step outreach cadences and enroll leads, so that reps follow consistent engagement sequences.

#### Acceptance Criteria

1. WHEN a user creates a cadence, THE App SHALL set its status to DRAFT
2. WHEN a user activates a cadence, THE App SHALL require at least one step exists before allowing activation
3. WHEN a user archives a cadence, THE App SHALL exit all ACTIVE enrollments with reason "cadence_archived"
4. WHILE a cadence is ARCHIVED, THE App SHALL reject all step modification requests
5. WHEN a lead is enrolled in a cadence, THE App SHALL create an enrollment with status ACTIVE and currentStepOrder 1
6. IF a lead already has an ACTIVE enrollment in the same cadence, THEN THE App SHALL reject the duplicate enrollment
7. WHEN a cadence step executes, THE Job_System SHALL create a StepExecutionLog entry recording the outcome (status: SUCCESS, FAILED, SKIPPED), attempt count, and error details if applicable, then advance the enrollment to the next step only on success
8. WHEN the final step completes, THE App SHALL mark the enrollment as COMPLETED
9. WHEN a reply or meeting event occurs for an enrolled lead, THE App SHALL exit the enrollment with reason "reply_received" or "meeting_booked"
10. THE App SHALL support step action types: EMAIL (with subject/body and personalization tags), CALL, LINKEDIN, MANUAL_TASK

#### Correctness Properties

- Invariant: A cadence always starts in DRAFT status
- Invariant: No duplicate ACTIVE enrollments for the same lead+cadence pair
- Metamorphic: Archiving a cadence reduces active enrollment count to zero
- Round-trip: Step reorder preserves the complete set of steps (no steps lost or duplicated)
- Invariant: Step orders are always contiguous integers starting from 1

---

### Requirement 7: Email Integration (Gmail OAuth)

**User Story:** As a sales rep, I want to connect my Gmail account and send/receive emails within the CRM, so that all communication is tracked automatically.

#### Acceptance Criteria

1. WHEN a user connects their Gmail account, THE App SHALL exchange the OAuth code for tokens and store them encrypted (AES-256-CBC) in the Database
2. WHEN sending an email, THE App SHALL replace personalization tags ({{FirstName}}, {{LastName}}, {{FullName}}, {{CompanyName}}, {{Title}}) with lead data
3. WHEN sending an email with HTML content, THE App SHALL wrap it in a proper HTML document with base styling for consistent rendering
4. WHEN an email is sent, THE App SHALL create an EmailMessage record with threadId for reply-in-thread support
5. WHEN OAuth tokens expire, THE App SHALL automatically refresh them using the stored refresh token (with 5-minute buffer)
6. THE Job_System SHALL sync emails from connected accounts on demand via an Inngest function

#### Correctness Properties

- Round-trip: Encrypting then decrypting OAuth tokens returns the original token value
- Invariant: All personalization tags in a sent email are replaced (no raw {{Tag}} in output)
- Idempotence: Token refresh with a still-valid token does not change the stored token

---

### Requirement 8: AI Features (Email Generation, Account Research, Chatbot)

**User Story:** As a sales rep, I want AI-powered email drafting, account research, and a chatbot assistant, so that I can work more efficiently.

#### Acceptance Criteria

1. WHEN a user requests AI email generation, THE App SHALL send lead context (name, title, company, last 5 interactions) plus the admin-configured system prompt to the AI_Provider and return structured {subject, body}
2. WHEN a user requests account research, THE App SHALL send company details to the AI_Provider and return structured intelligence (executive summary, strategic goals, sales angles, challenges)
3. THE App SHALL provide an AI chatbot sidebar accessible from every page that answers questions and can perform actions (create leads, tasks, navigate) with user confirmation
4. WHILE an AI prompt config is inactive, THE App SHALL exclude it from AI requests
5. WHEN an AI API call fails, THE App SHALL return a generic error message (e.g., "AI service temporarily unavailable") without exposing API keys, internal URLs, model names, or system details — IF generating any specific error message risks exposing internals, THEN THE App SHALL fall back to the generic message

#### Correctness Properties

- Error condition: AI failures never expose API keys or internal system details in the response
- Invariant: AI requests always include the admin-configured system prompt when active

---

### Requirement 9: Rhythm Engine (Signal-Based Prioritization)

**User Story:** As a sales rep, I want my tasks prioritized by urgency signals, so that I focus on the highest-impact actions first.

#### Acceptance Criteria

1. THE App SHALL calculate a priority score (1-100) for each pending action based on weighted signals: overdue duration (+2/hour, max 30), deal value (+1 per $5K, max 20), lead score (+1 per 5 points above 50), inactivity days (+1/day over 7, max 15), task priority HIGH (+10)
2. THE App SHALL present actions sorted by priority score descending
3. WHILE a user has role MANAGER, THE App SHALL display a team view aggregating signals across all reps with overdue counts and top 3 urgent actions per rep
4. THE App SHALL calculate a Deal Engagement Score (1-100) per lead with factors: Activity Recency (0-25), Stakeholder Count (0-20), Activity Volume (0-20), Deal Progression (0-20), Lead Score (0-15)
5. THE App SHALL classify deal health as: Healthy (60+), At Risk (35-59), Critical (<35)
6. THE App SHALL identify deal gaps: no activity in 7+ days, no future meeting scheduled, single-threaded (≤1 contact linked) — however, THE App SHALL skip single-threaded flagging when the deal has both a scheduled future meeting AND recent activity within 7 days

#### Correctness Properties

- Invariant: Priority score is always clamped to range [1, 100]
- Invariant: Deal Engagement Score is always clamped to range [1, 100]
- Metamorphic: Increasing deal value never decreases priority score
- Confluence: Calculating priority score with the same inputs in any order produces the same result

---

### Requirement 10: Revenue Forecasting

**User Story:** As a manager, I want pipeline forecasting with AI predictions and commit tracking, so that I can accurately project revenue.

#### Acceptance Criteria

1. THE App SHALL calculate total pipeline value (sum of open deal values), weighted pipeline (value × stage-based win probability), and AI predicted (70% weighted + 30% recent monthly run rate)
2. WHEN a manager submits a forecast, THE App SHALL store the commit amount for the specified period (YYYY-MM format)
3. THE App SHALL compare Team Commit vs AI Predicted and flag risk: On Track (<15% gap), At Risk (15-30%), High Risk (>30%)
4. THE Job_System SHALL create daily pipeline snapshots (ForecastSnapshot) via a scheduled Inngest function for trend tracking
5. THE App SHALL calculate historical win rate from the last 90 days of closed deals, capped at 100% maximum

#### Correctness Properties

- Invariant: Weighted pipeline is always less than or equal to total pipeline value
- Invariant: AI predicted value is always a positive number when pipeline has open deals
- Metamorphic: Adding a deal to the pipeline never decreases total pipeline value

---

### Requirement 11: CSV Import and Export

**User Story:** As a sales rep, I want to import leads from CSV files and export current data, so that I can bulk-manage my pipeline.

#### Acceptance Criteria

1. WHEN a user uploads a CSV file, THE App SHALL parse headers, detect row count, and present a column mapping interface
2. WHEN a user confirms the mapping, THE App SHALL validate each row (requiring lead firstName, lastName, stage), and for each valid row SHALL guarantee completion of all actions: create companies as needed, create leads with stage transitions, and link contacts — partial completion of a valid row is not acceptable
3. THE App SHALL log an audit entry (action: CREATE, entity: Lead) for each successfully imported lead
4. IF a row fails validation, THEN THE App SHALL skip it and include the error reason in the import summary
5. THE App SHALL report import results as: successCount + skipCount = totalRows
6. WHEN a user exports leads, THE App SHALL generate a CSV file excluding soft-deleted leads

#### Correctness Properties

- Invariant: successCount + skipCount always equals totalRows
- Metamorphic: Importing N valid rows increases lead count by exactly N
- Error condition: Invalid rows are skipped without affecting valid row processing

---

### Requirement 12: Full-Text Search

**User Story:** As a sales rep, I want to search across leads, contacts, and companies with instant results, so that I can quickly find records.

#### Acceptance Criteria

1. THE App SHALL maintain PostgreSQL tsvector fields on Lead, Contact, and Company models with GIN indexes
2. WHEN a user submits a search query, THE Search_Engine SHALL return ranked results across all three entity types
3. THE App SHALL exclude soft-deleted leads from search results
4. THE App SHALL support filtering search results by entity type, date range, and assigned user

#### Correctness Properties

- Invariant: Soft-deleted leads never appear in search results
- Idempotence: Searching the same query twice returns the same results (given no data changes)

---

### Requirement 13: File Storage

**User Story:** As a sales rep, I want to attach files to activities, so that I can keep relevant documents with interaction records.

#### Acceptance Criteria

1. WHEN a user uploads a file, THE App SHALL store it in a Supabase Storage bucket and create a FileAttachment record with fileName, fileSize, mimeType, and storage path
2. THE Storage SHALL enforce RLS policies so users can only access files belonging to leads they have permission to view
3. WHEN a user downloads a file, THE App SHALL generate a signed URL from Supabase Storage with a short expiration
4. THE App SHALL validate file uploads: maximum 25 MB per file, allowed MIME types (PDF, images, documents, spreadsheets)

#### Correctness Properties

- Round-trip: Uploading a file then downloading it returns identical content
- Invariant: File access respects the same RBAC rules as lead access
- Error condition: Files exceeding 25 MB are rejected with a descriptive error

---

### Requirement 14: Background Jobs (Inngest)

**User Story:** As a system operator, I want reliable background job processing with retries and scheduling, so that async operations complete even after transient failures.

#### Acceptance Criteria

1. THE Job_System SHALL execute cadence steps as durable Inngest functions with configurable delays between steps — delay configuration (in hours) SHALL be available per step and required for the cadence to function correctly
2. THE Job_System SHALL sync emails from connected Gmail accounts via an on-demand Inngest function
3. THE Job_System SHALL run score decay daily at midnight UTC, reducing scores for leads inactive beyond the configured threshold
4. THE Job_System SHALL check for tasks due within 24 hours on an hourly schedule and flag them in the Rhythm dashboard
5. THE Job_System SHALL create daily forecast snapshots via a scheduled Inngest function
6. WHEN an Inngest function fails, THE Job_System SHALL retry up to 3 times with exponential backoff
7. THE App SHALL expose an Inngest serve endpoint at `/api/inngest` for event ingestion and function registration

#### Correctness Properties

- Idempotence: Running score decay twice in the same day produces the same result as running it once
- Invariant: Failed jobs are retried exactly 3 times before being marked as failed
- Invariant: Cadence step execution for a non-ACTIVE enrollment is a no-op

---

### Requirement 15: Rate Limiting

**User Story:** As a system operator, I want per-IP rate limiting, so that the system is protected from abuse and brute-force attacks.

#### Acceptance Criteria

1. THE App SHALL enforce rate limits via Upstash Redis using `@upstash/ratelimit` with sliding window algorithm
2. THE App SHALL apply three rate limit tiers: general API (100 requests/minute), auth endpoints (10 requests/minute), write operations (30 requests/minute)
3. WHEN a rate limit is exceeded, THE App SHALL return HTTP 429 with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers
4. THE App SHALL implement login brute-force protection: after 5 failed attempts within 15 minutes for the same IP+email, lock out that combination for 15 minutes — the lockout SHALL persist for the full duration even if a correct password is submitted during the lockout period
5. WHEN a successful login occurs outside of a lockout period, THE App SHALL clear the failure counter for that IP+email combination

#### Correctness Properties

- Invariant: Request count never exceeds the configured limit within the sliding window
- Idempotence: Checking rate limit status without making a request does not consume a token
- Round-trip: Successful login always resets the brute-force counter to zero

---

### Requirement 16: Lead Scoring and Assignment

**User Story:** As a manager, I want automated lead scoring and rule-based assignment, so that leads are prioritized and distributed efficiently.

#### Acceptance Criteria

1. THE App SHALL calculate lead scores (0-100) based on configurable scoring rules: activity count, deal value, stage progression, email engagement
2. WHEN a scoring event occurs, THE App SHALL create a ScoreHistory entry with previousScore, newScore, and reason
3. THE App SHALL clamp lead scores to the range [0, 100] after any calculation
4. WHEN a new lead is created without an assignee, THE App SHALL evaluate assignment rules in priority order (lowest priority number first) — IF the lead already has an assignee, THEN THE App SHALL skip rule evaluation entirely
5. THE App SHALL support assignment rule types: TERRITORY (company/region match), DEAL_SIZE (min/max range), ROUND_ROBIN (even distribution via Upstash Redis counter)
6. IF no assignment rule matches, THEN THE App SHALL leave the lead unassigned

#### Correctness Properties

- Invariant: Lead score is always in range [0, 100]
- Invariant: Assignment rules are evaluated in ascending priority order
- Confluence: Round-robin distribution produces even allocation regardless of creation timing
- Metamorphic: Adding an activity to a lead never decreases its score

---

### Requirement 17: Pipeline and Kanban Board

**User Story:** As a sales rep, I want a visual Kanban board showing leads by stage, so that I can drag leads through the pipeline.

#### Acceptance Criteria

1. THE App SHALL display leads grouped by pipeline stage in a drag-and-drop Kanban board
2. WHEN a user drags a lead to a different stage, THE App SHALL create a StageTransition record and update the lead's stageId
3. THE App SHALL maintain stage order as contiguous integers and support reordering by managers
4. WHILE a user has role MEMBER, THE App SHALL only show leads assigned to that user on the Kanban board — IF the user has no assigned leads, THEN THE App SHALL display an empty Kanban board with all stage columns visible
5. THE App SHALL display deal value and lead score on each Kanban card

#### Correctness Properties

- Invariant: Stage reorder preserves all stages (no stages lost or duplicated)
- Invariant: Stage orders are always contiguous integers
- Round-trip: Moving a lead to a stage then querying that stage includes the lead

---

### Requirement 18: Task Management

**User Story:** As a sales rep, I want to create and manage tasks with due dates and priorities, so that I stay on top of follow-ups.

#### Acceptance Criteria

1. WHEN a user creates a task, THE App SHALL validate with Zod (requiring title, dueDate, leadId, assigneeId) and persist it
2. THE App SHALL support task priorities: LOW, MEDIUM, HIGH
3. WHEN a task is marked complete, THE App SHALL set isComplete to true and record completedAt timestamp
4. THE App SHALL list tasks sorted by dueDate ascending, with overdue tasks highlighted — a task SHALL be considered overdue immediately when its due time passes (no grace period)
5. WHILE a user has role MEMBER, THE App SHALL only show tasks assigned to that user
6. WHEN a task is reassigned, THE App SHALL update the assigneeId to the new user and validate the new assignee exists

#### Correctness Properties

- Invariant: Completed tasks always have a non-null completedAt timestamp
- Metamorphic: Marking a task complete does not change any other task's state
- Invariant: Task list is always sorted by dueDate ascending

---

### Requirement 19: Contacts and Companies

**User Story:** As a sales rep, I want to manage contacts and companies linked to leads, so that I can track stakeholder relationships.

#### Acceptance Criteria

1. WHEN a user creates a contact, THE App SHALL validate with Zod (requiring firstName, lastName) and persist it
2. THE App SHALL support many-to-many relationships between leads and contacts via LeadContact join table
3. WHEN a user creates a company, THE App SHALL validate with Zod (requiring name) and persist it
4. THE App SHALL allow linking contacts to companies and leads to companies
5. THE App SHALL maintain tsvector search fields on Contact and Company models

#### Correctness Properties

- Invariant: LeadContact join records always reference existing lead and contact IDs
- Round-trip: Linking a contact to a lead then querying the lead's contacts includes that contact

---

### Requirement 20: Audit Logging

**User Story:** As an admin, I want a complete audit trail of all data changes, so that I can track who changed what and when.

#### Acceptance Criteria

1. WHEN a create, update, or delete operation occurs on a tracked entity, THE App SHALL create an AuditEntry with userId, action, entityType, entityId, and changes (old/new values for updates)
2. THE App SHALL log audit entries asynchronously so that logging failures do not block the primary operation
3. WHILE a user has role ADMIN, THE App SHALL provide read access to the full audit log interface with filtering by entity type, user, and date range — THE audit log interface SHALL be accessible even when no audit entries exist yet (showing an empty state)
4. THE App SHALL make audit entries immutable — no update or delete operations on AuditEntry records

#### Correctness Properties

- Invariant: Audit entries are immutable (never modified after creation)
- Metamorphic: Every successful CUD operation produces exactly one audit entry
- Invariant: Audit entries always reference a valid userId

---

### Requirement 21: Security Hardening

**User Story:** As a system operator, I want defense-in-depth security measures, so that the application is protected against common web attacks.

#### Acceptance Criteria

1. THE App SHALL set security headers via Next.js middleware: X-Content-Type-Options (nosniff), X-Frame-Options (DENY), Strict-Transport-Security, Referrer-Policy (strict-origin-when-cross-origin), Permissions-Policy (disable camera, microphone, geolocation, payment)
2. THE App SHALL validate all API inputs with Zod schemas, rejecting requests that fail validation with HTTP 400 — WHEN validation passes, THE App SHALL apply additional security layers (sanitization, size checks, prototype pollution detection) before processing the request
3. THE App SHALL enforce maximum request body size of 1 MB for non-file endpoints and reject zero-body requests on endpoints that require a body with HTTP 400
4. THE App SHALL block path traversal attempts (`..` and encoded variants) in all URL parameters
5. THE App SHALL strip null bytes from all string inputs
6. THE App SHALL block prototype pollution attempts (`__proto__`, `constructor`, `prototype` keys in JSON bodies)
7. THE App SHALL enforce Content-Security-Policy headers appropriate for the application

#### Correctness Properties

- Invariant: Every API response includes all required security headers
- Error condition: Path traversal attempts always return HTTP 400
- Error condition: Prototype pollution payloads always return HTTP 400

---

### Requirement 22: Environment Variable Validation

**User Story:** As a developer, I want environment variables validated at startup, so that misconfigurations are caught immediately rather than at runtime.

#### Acceptance Criteria

1. WHEN the App starts, THE Validator SHALL validate all required environment variables against a Zod schema and halt startup with descriptive errors if validation fails
2. THE App SHALL require these core environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, DIRECT_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, EMAIL_ENCRYPTION_KEY, AI_API_KEY — THE App SHALL also support optional feature-flag variables (AI_API_URL, AI_MODEL) that default to sensible values when absent
3. THE App SHALL validate URL-type variables are valid URLs and key-type variables are non-empty strings
4. THE App SHALL export a typed `env` object for use throughout the application, eliminating raw `process.env` access

#### Correctness Properties

- Error condition: Missing or invalid environment variables prevent application startup with a clear error message
- Invariant: The typed env object always contains validated values matching the Zod schema
- Round-trip: Defining a valid env var then accessing it via the typed object returns the same value

---

### Requirement 23: Deployment and CI/CD

**User Story:** As a developer, I want automated testing, migration, and deployment, so that changes ship reliably.

#### Acceptance Criteria

1. WHEN code is pushed to any branch, THE CI_Pipeline SHALL run the full test suite (unit + property-based tests) via GitHub Actions
2. WHEN code is pushed to main, THE CI_Pipeline SHALL run Supabase CLI to apply pending database migrations before Vercel deploys
3. THE Deploy_Platform SHALL auto-deploy the application on every push to main only after both CI passes AND the build succeeds — IF the build fails even when CI technically passes, THEN THE deployment SHALL be blocked
4. THE App SHALL use Prisma v6 with pooled connection string (DATABASE_URL via Supabase connection pooler) for queries and direct connection string (DIRECT_URL) for migrations — WHEN either DATABASE_URL or DIRECT_URL is missing or misconfigured, THE App SHALL fail startup with a descriptive error naming the problematic variable
5. THE CI_Pipeline SHALL fail the build if TypeScript compilation produces errors (strict mode enforced)

#### Correctness Properties

- Invariant: No deployment occurs if the test suite fails
- Invariant: Database migrations always run before application deployment
- Idempotence: Running migrations multiple times does not produce errors or duplicate changes

---

### Requirement 24: Testing Infrastructure

**User Story:** As a developer, I want comprehensive test coverage with property-based tests, so that correctness invariants are continuously verified.

#### Acceptance Criteria

1. THE App SHALL use Vitest v3 as the test runner with a configuration supporting both unit tests and property-based tests
2. THE App SHALL use fast-check v3 for property-based testing, targeting the same invariants covered in the source repo (76+ property tests)
3. THE App SHALL achieve property-based test coverage with a minimum of 3-5 property tests per area for: score clamping, stage reorder preservation, CSV import arithmetic, audit immutability, assignment rule priority, round-robin distribution, cadence state machine, enrollment lifecycle, RBAC enforcement, step management
4. THE App SHALL organize tests co-located with their modules in `__tests__` directories
5. THE App SHALL support running tests in CI without external service dependencies (mocked Prisma, mocked Supabase)

#### Correctness Properties

- Invariant: All property-based tests pass on every CI run
- Metamorphic: Adding a new property test never causes existing tests to fail

---

### Requirement 25: Observability and Error Handling

**User Story:** As a developer, I want structured error responses and logging, so that issues are diagnosable in production.

#### Acceptance Criteria

1. THE App SHALL return consistent JSON error responses: `{ "error": { "code": string, "message": string } }` for all error cases
2. THE App SHALL use standard HTTP status codes: 400 (validation), 401 (unauthorized), 403 (forbidden), 404 (not found), 429 (rate limited), 500 (internal)
3. IF an unhandled error occurs, THEN THE App SHALL return HTTP 500 with a generic message and log the full error server-side without exposing internals to the client — THE App SHALL always return the generic error response to the client regardless of whether server-side logging succeeds or fails
4. THE App SHALL include request tracing via unique request IDs in response headers
5. WHEN an Inngest function fails after all retries, THE Job_System SHALL log the failure with function name, event payload summary, and error details

#### Correctness Properties

- Invariant: Error responses always conform to the `{ error: { code, message } }` schema
- Invariant: HTTP 500 responses never contain stack traces or internal details
- Error condition: All unhandled exceptions are caught and produce a valid error response

---

### Requirement 26: Tech Stack Standards and Code Quality

**User Story:** As a developer, I want enforced coding standards and consistent architecture, so that the codebase remains maintainable and type-safe.

#### Acceptance Criteria

1. THE App SHALL use strict TypeScript (`strict: true` in tsconfig) with zero `any` types and no unsafe `as` casts unless annotated with a justification comment
2. THE App SHALL use Zod v3 for ALL data validation: Route Handler inputs, Server Action inputs, form schemas, environment variables, and external API response parsing
3. THE App SHALL use TanStack Query v5 for all server state management (data fetching, caching, optimistic updates, mutations) in client components
4. THE App SHALL use Zustand v5 for client-side UI state (replacing Context-based patterns like LayoutContext and AuthContext state)
5. THE App SHALL follow the organized folder structure: `src/app/` (routes), `src/components/` (shared + feature), `src/lib/` (utilities and configs), `src/hooks/` (custom hooks), `src/stores/` (Zustand stores), `src/types/` (TypeScript types), `src/server/` (server-only business logic)
6. THE App SHALL pin all dependencies to exact versions (no `^` or `~` ranges in package.json)
7. THE App SHALL use only actively maintained packages with no deprecated dependencies
8. THE App SHALL use Prisma v6 as the ORM with the Supabase Postgres database
9. THE App SHALL use Shadcn/ui + Tailwind CSS v4 for all UI components with TipTap for rich text editing
10. THE App SHALL use Next.js App Router exclusively — no Pages Router, no client-side routing libraries

#### Correctness Properties

- Invariant: TypeScript compilation with `strict: true` produces zero errors
- Invariant: All API inputs pass through a Zod schema before processing
- Invariant: No `any` type annotations exist in the codebase (enforced by ESLint rule)
- Invariant: All package.json versions are exact (no range specifiers)

---

### Requirement 27: Duplicate Detection and Lead Merge

**User Story:** As a sales rep, I want to detect duplicate leads and merge them, so that I maintain a clean pipeline without redundant records.

#### Acceptance Criteria

1. WHEN a user checks for duplicates, THE App SHALL search for matching leads by contact email (case-insensitive) and/or company name (case-insensitive)
2. THE App SHALL return a list of potential duplicate matches with leadId, leadName, matchType (email or company), and matchValue
3. WHEN a user merges two leads, THE App SHALL move all activities and contacts from the secondary lead to the primary lead within a single transaction
4. WHEN merging leads, THE App SHALL avoid creating duplicate LeadContact links (skip contacts already linked to the primary lead)
5. WHEN the merge completes, THE App SHALL delete the secondary lead — the primary lead retains its stage, score, assigned user, and all other fields
6. THE App SHALL reject a merge where primaryLeadId equals mergeLeadId (cannot merge a lead with itself)
7. WHEN importing leads via CSV, THE App SHALL run duplicate detection per row and skip rows that match existing leads

#### Correctness Properties

- Invariant: After merge, the primary lead has the union of both leads' activities and contacts
- Invariant: No duplicate LeadContact records exist after merge
- Error condition: Self-merge always returns an error
- Round-trip: Merging then querying the primary lead includes all activities from both original leads

---

### Requirement 28: Dashboard Analytics

**User Story:** As a manager, I want pipeline analytics with conversion rates and stage metrics, so that I can identify bottlenecks and optimize the sales process.

#### Acceptance Criteria

1. THE App SHALL calculate total deal value per pipeline stage (sum of dealValue for leads in each stage)
2. THE App SHALL calculate stage-to-stage conversion rates (leads transitioned / leads that entered the source stage)
3. THE App SHALL calculate average time in each stage (mean of exit timestamp - entry timestamp for leads that left)
4. THE App SHALL display lead count per stage grouped by pipeline
5. THE App SHALL display closed won/lost summary counts for a given period
6. THE App SHALL support date range filtering on all dashboard metrics
7. THE App SHALL display these metrics in a "Pipeline Metrics" tab on the dashboard

#### Correctness Properties

- Invariant: Conversion rate is always between 0 and 1 (inclusive)
- Invariant: Stage duration is always non-negative
- Metamorphic: Adding a lead to a stage increases that stage's lead count by exactly 1

---

### Requirement 29: Lead Conversion to Contact

**User Story:** As a sales rep, I want to convert a won lead into a contact, so that I can track the relationship post-sale.

#### Acceptance Criteria

1. WHEN a user converts a lead, THE App SHALL create a new Contact record with the lead's personal data (firstName, lastName, email, phone, title, linkedinUrl, country, state, companyId)
2. WHEN converting, THE App SHALL move the lead to the "Closed Won" stage in its pipeline and set isClosed=true and closeDate=now
3. WHEN converting, THE App SHALL link the new contact to the lead via LeadContact
4. WHEN converting, THE App SHALL exit all active cadence enrollments for that lead with reason "lead_converted"
5. IF no "Closed Won" stage exists in the lead's pipeline, THEN THE App SHALL reject the conversion with a descriptive error

#### Correctness Properties

- Invariant: After conversion, the lead is always in Closed Won stage with isClosed=true
- Invariant: The new contact is always linked to the original lead
- Metamorphic: Converting a lead exits all its active cadence enrollments

---

### Requirement 30: Coaching Comments

**User Story:** As a manager, I want to leave coaching comments on activities, so that I can provide feedback and guidance to my team.

#### Acceptance Criteria

1. WHEN a manager adds a coaching comment, THE App SHALL create a CoachingComment record linked to the activity with authorId, content, and optional mentionedUserId
2. THE App SHALL list coaching comments for an activity sorted by createdAt ascending
3. THE App SHALL support @mentioning a user in a coaching comment (stored as mentionedUserId)
4. WHILE a user has role MEMBER, THE App SHALL only show coaching comments on their own activities

#### Correctness Properties

- Invariant: Coaching comments are always linked to a valid activity
- Metamorphic: Adding a coaching comment increases the comment count for that activity by exactly 1

---

### Requirement 31: Conversation Intelligence (Meeting Summarization)

**User Story:** As a sales rep, I want AI-generated meeting summaries with key topics and action items, so that I can quickly review past conversations.

#### Acceptance Criteria

1. WHEN a user requests a meeting summary, THE App SHALL send the meeting activity data (notes, attendees, date) to the AI_Provider and return structured output: aiSummary, keyTopics, actionItems, sentiment
2. THE App SHALL store the generated summary on the activity for future retrieval without re-generating
3. THE App SHALL list all meeting summaries for a lead (conversation history)
4. THE App SHALL detect keyword trackers in meeting notes and return matched contexts

#### Correctness Properties

- Idempotence: Requesting a summary for an already-summarized meeting returns the stored summary without calling AI again
- Error condition: AI failures return a generic error without exposing internals

---

### Requirement 32: Cadence Extended Features (Pause, Resume, Bulk Enroll, Delete, Analytics)

**User Story:** As a manager, I want full lifecycle control over cadences including pause/resume, bulk enrollment, deletion, and performance analytics.

#### Acceptance Criteria

1. WHEN a user pauses an active enrollment, THE App SHALL set status to PAUSED and cancel all pending scheduled jobs for that enrollment
2. WHEN a user resumes a paused enrollment, THE App SHALL set status to ACTIVE and schedule the next due step
3. THE App SHALL support bulk enrollment of multiple leads into a cadence (same validations as single enrollment per lead)
4. WHEN a user deletes a cadence, THE App SHALL reject the deletion if active enrollments exist — otherwise delete all related enrollments, steps, and execution logs
5. THE App SHALL provide cadence analytics: total enrollments, active/completed/exited counts, completion rate, average completion time, and per-step metrics (reached, completed, exited)
6. WHILE a cadence is ACTIVE with active enrollments, THE App SHALL only allow appending new steps (no reorder or removal)

#### Correctness Properties

- Invariant: Only ACTIVE enrollments can be paused
- Invariant: Only PAUSED enrollments can be resumed
- Invariant: Cadences with active enrollments cannot be deleted
- Round-trip: Pausing then resuming an enrollment returns it to ACTIVE status

---

### Requirement 33: Deletion Request Workflow

**User Story:** As a team member, I want to request deletion of records that require manager approval, so that data integrity is maintained while allowing cleanup.

#### Acceptance Criteria

1. WHEN a MEMBER requests deletion of a record, THE App SHALL create a DeletionRequest with status "pending" (entityType, entityId, entityName, reason, requestedById)
2. IF a pending deletion request already exists for the same entity, THEN THE App SHALL reject the duplicate request
3. WHEN a MANAGER or ADMIN approves a deletion request, THE App SHALL execute the deletion (soft-delete for leads, hard delete for contacts/tasks) and mark the request as "approved"
4. WHEN a MANAGER or ADMIN rejects a deletion request, THE App SHALL mark the request as "rejected" without executing any deletion
5. WHILE a user has role MANAGER or ADMIN, THE App SHALL allow direct deletion without requiring a request
6. THE App SHALL list pending deletion requests for managers/admins to review

#### Correctness Properties

- Invariant: Only pending requests can be approved or rejected
- Invariant: Approved requests always result in the entity being deleted
- Error condition: Duplicate pending requests for the same entity are always rejected

---

### Requirement 34: Lead Closed State and Stage Flags

**User Story:** As a sales rep, I want leads to automatically track closed state when moved to terminal stages, so that pipeline metrics are accurate.

#### Acceptance Criteria

1. THE App SHALL support `isClosedWon` and `isClosedLost` boolean flags on Stage model to identify terminal stages
2. THE App SHALL support `isClosed` boolean and `closeDate` timestamp fields on Lead model
3. WHEN a lead is moved to a stage with `isClosedWon=true` or `isClosedLost=true`, THE App SHALL set `isClosed=true` and `closeDate=now()` on the lead
4. WHEN a lead is moved from a closed stage to a non-closed stage, THE App SHALL set `isClosed=false` and `closeDate=null`
5. THE App SHALL use `isClosed` and `closeDate` for forecasting calculations (win rate, closed won/lost counts)

#### Correctness Properties

- Invariant: A lead in a closed stage always has isClosed=true and a non-null closeDate
- Invariant: A lead in a non-closed stage always has isClosed=false
- Round-trip: Moving a lead to Closed Won then back to an open stage resets isClosed to false
