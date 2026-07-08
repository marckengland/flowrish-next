# Implementation Plan: Lead Management System

## Overview

Incremental implementation of a full-stack lead management system using Fastify + TypeScript backend, React + TypeScript frontend, PostgreSQL with Prisma ORM, Redis + BullMQ for background jobs, and S3-compatible file storage. Tasks progress from project scaffolding → data layer → backend services → API routes → frontend → integration wiring. All dependency versions follow `.kiro/steering/tech-stack-versions.md`.

## Tasks

- [x] 1. Project scaffolding and configuration
  - [x] 1.1 Initialize monorepo with backend and frontend packages
    - Create root `package.json` with workspaces for `packages/backend` and `packages/frontend`
    - Initialize backend: `npm install fastify@^5 @fastify/cors @fastify/jwt @fastify/multipart typescript@~5.7 prisma@^7 @prisma/client@^7 bullmq@^5.71 passport@^0.7 passport-google-oauth20 nodemailer@^6 ioredis @aws-sdk/client-s3`
    - Initialize frontend: `npm install react@^19.2 react-dom@^19.2 @tanstack/react-query@^5 tailwindcss@^4.2 react-router`; run `npx shadcn@latest init`
    - Install dev deps: `npm install -D vitest@^3 fast-check@^3 @testing-library/react supertest`
    - Configure `tsconfig.json` for both packages with strict mode
    - _Requirements: All (project foundation)_

  - [x] 1.2 Set up Prisma schema and initial migration
    - Create `packages/backend/prisma/schema.prisma` with all models from the design document (User, Pipeline, Stage, Lead, Company, Contact, LeadContact, Activity, FileAttachment, StageTransition, Task, ScoringRule, ScoreDecayConfig, ScoreHistory, AssignmentRule, EmailAccount, EmailMessage, AuditEntry, FieldMapping)
    - Add enums: Role, ActivityType, TaskPriority, AssignmentRuleType, AuditAction
    - Add indexes and unique constraints as specified in design
    - Add `searchVector` Unsupported("tsvector") fields on Lead, Company, Contact
    - Generate initial migration
    - _Requirements: 1.1, 2.1, 2.2, 4.2, 5.1, 6.1, 9.1, 11.1, 12.1, 13.1_

  - [x] 1.3 Set up Fastify app bootstrap and shared middleware
    - Create `packages/backend/src/app.ts` with Fastify instance, CORS, JWT plugin, multipart plugin
    - Create `packages/backend/src/common/middleware/errorHandler.ts` with consistent error response format from design
    - Create `packages/backend/src/common/types/` with shared TypeScript types and error codes
    - Set up Redis connection utility and BullMQ queue configuration
    - _Requirements: All (infrastructure)_

- [x] 2. Authentication and RBAC
  - [x] 2.1 Implement JWT authentication with refresh tokens
    - Create `packages/backend/src/modules/auth/` with login, token generation, refresh token logic
    - Store refresh tokens in Redis with expiry
    - Implement auth middleware that validates JWT on protected routes
    - Implement `/api/v1/me` endpoint
    - _Requirements: 3.1, 9.1_

  - [x] 2.2 Implement RBAC middleware and permission checks
    - Create `packages/backend/src/modules/rbac/` with role-checking middleware
    - Implement three-tier permission model: Team Member (own leads only), Manager (all leads), Admin (all + user/pipeline/scoring management)
    - Create `/api/v1/users` (Admin list), `/api/v1/users/:id/role` (Admin change role) endpoints
    - Permissions apply immediately on role change without re-login
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 2.3 Write property test for RBAC access control
    - **Property 23: RBAC access control**
    - Generate random users with roles and random lead assignments; verify Team Members can only access assigned leads, Managers access all, Admins access all plus management operations
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5**

- [x] 3. Checkpoint - Ensure auth and RBAC tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Pipeline and stage management
  - [x] 4.1 Implement pipeline and stage CRUD
    - Create `packages/backend/src/modules/leads/` with pipeline service and routes
    - Implement `POST /api/v1/pipelines` (enforce minimum 2 stages), `GET /api/v1/pipelines`, `GET /api/v1/pipelines/:id`, `PUT /api/v1/pipelines/:id`
    - Implement `PUT /api/v1/pipelines/:id/stages/reorder` ensuring all stages preserved with unique contiguous order values
    - _Requirements: 1.3, 1.4, 1.5_

  - [x] 4.2 Write property test for pipeline minimum stages
    - **Property 3: Pipeline requires minimum two stages**
    - Generate pipeline creation requests with varying stage counts; verify rejection for < 2 stages and acceptance for >= 2
    - **Validates: Requirements 1.4**

  - [x] 4.3 Write property test for stage reorder preservation
    - **Property 4: Stage reorder preserves all stages**
    - Generate pipelines with random stages and random reorderings; verify stage set identity and contiguous unique order values
    - **Validates: Requirements 1.5**

- [x] 5. Lead CRUD and stage transitions
  - [x] 5.1 Implement lead CRUD and stage movement
    - Create lead service with `POST /api/v1/leads`, `GET /api/v1/leads` (with filters, pagination), `GET /api/v1/leads/:id`, `PUT /api/v1/leads/:id`, `DELETE /api/v1/leads/:id`
    - Implement `POST /api/v1/leads/:id/move` — create StageTransition record with timestamp, set `isClosed`/`closeDate` when target stage is Closed Won/Lost
    - Validate lead name is required on creation
    - Apply RBAC: Team Members see only assigned leads
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 9.2_

  - [x] 5.2 Write property test for stage transitions and closed-stage handling
    - **Property 1: Stage transition records and closed-stage handling**
    - Generate leads and stage moves; verify StageTransition records created with timestamps, and isClosed/closeDate set for Closed Won/Lost stages
    - **Validates: Requirements 1.2, 1.6**

  - [x] 5.3 Write property test for pipeline stage grouping
    - **Property 2: Pipeline stage grouping partitions all leads**
    - Generate sets of leads in a pipeline; verify grouping by stage produces a partition where sum equals total and no lead appears in multiple groups
    - **Validates: Requirements 1.3, 7.5**

- [x] 6. Contact and company management
  - [x] 6.1 Implement contact and company CRUD
    - Create `packages/backend/src/modules/contacts/` and `packages/backend/src/modules/companies/`
    - Implement contact endpoints: `POST /api/v1/contacts`, `GET /api/v1/contacts`, `GET /api/v1/contacts/:id`, `PUT /api/v1/contacts/:id`, `DELETE /api/v1/contacts/:id`
    - Implement company endpoints: `POST /api/v1/companies`, `GET /api/v1/companies`, `GET /api/v1/companies/:id` (with leads and contacts), `PUT /api/v1/companies/:id`, `DELETE /api/v1/companies/:id` (with confirmation prompt for companies with leads)
    - Implement lead-contact linking (many-to-many via LeadContact) and lead-company linking (one-to-one)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 6.2 Write property test for entity creation round-trip
    - **Property 5: Entity creation round-trip**
    - Generate random Contact and Company data; verify create-then-retrieve returns all fields equal to input
    - **Validates: Requirements 2.1, 2.2**

  - [x] 6.3 Write property test for company association queries
    - **Property 6: Company association queries**
    - Generate contacts/leads associated with companies; verify company queries include associated entities
    - **Validates: Requirements 2.3, 2.6**

  - [x] 6.4 Write property test for lead-contact and lead-company cardinality
    - **Property 7: Lead-contact many-to-many and lead-company one-to-one**
    - Generate leads with N contacts; verify query returns exactly N. Verify lead links to at most one company
    - **Validates: Requirements 2.4, 2.5**

- [x] 7. Checkpoint - Ensure core entity tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Activity timeline and file attachments
  - [x] 8.1 Implement activity logging and timeline
    - Create `packages/backend/src/modules/activities/`
    - Implement `POST /api/v1/leads/:id/activities` supporting Call (callDate, callDuration, notes), Meeting (meetingDate, attendees, notes), Note (text, timestamp), Email, File Attachment types
    - Implement `GET /api/v1/leads/:id/activities` returning activities in reverse chronological order with type filtering
    - Update lead's `lastActivityAt` on new activity
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 8.2 Implement file upload/download with S3
    - Create `packages/backend/src/modules/files/` with S3 integration using `@aws-sdk/client-s3`
    - Implement `POST /api/v1/activities/:id/files` — validate file size <= 25MB, upload to S3, record FileAttachment metadata
    - Implement `GET /api/v1/files/:id/download` — generate presigned URL for download/preview
    - Reject uploads exceeding 25MB with validation error
    - _Requirements: 4.8, 4.9, 4.10, 4.11_

  - [x] 8.3 Write property test for activity timeline ordering and filtering
    - **Property 10: Activity timeline ordering and filtering**
    - Generate activities with random timestamps and types; verify reverse chronological order and type filtering correctness
    - **Validates: Requirements 4.1, 4.7**

  - [x] 8.4 Write property test for activity data integrity
    - **Property 11: Activity data integrity**
    - Generate activities of each type; verify Call has callDate/callDuration/notes, Meeting has meetingDate/attendees/notes, Note has text/timestamp
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6**

  - [x] 8.5 Write property test for file attachment validation
    - **Property 12: File attachment size validation and metadata**
    - Generate file uploads with random sizes; verify <= 25MB accepted with correct metadata, > 25MB rejected
    - **Validates: Requirements 4.8, 4.9, 4.11**

- [x] 9. Task and reminder system
  - [x] 9.1 Implement task CRUD and reminders
    - Create `packages/backend/src/modules/tasks/`
    - Implement `POST /api/v1/tasks` (validate due date required), `GET /api/v1/tasks` (sorted by due date for current user), `GET /api/v1/tasks/:id`, `PUT /api/v1/tasks/:id`
    - Implement `PUT /api/v1/tasks/:id/complete` — record completion timestamp, log Activity on associated lead
    - Implement `PUT /api/v1/tasks/:id/reassign`
    - Create BullMQ job `taskReminder.ts` — check tasks due within 24 hours, send notification to assignee
    - Flag overdue tasks (past due date + not complete)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 9.2 Write property test for task lifecycle
    - **Property 13: Task creation and completion lifecycle**
    - Generate valid task data; verify all fields persisted. Mark complete; verify completion timestamp and activity logged on lead
    - **Validates: Requirements 5.1, 5.3**

  - [x] 9.3 Write property test for task overdue detection
    - **Property 14: Task overdue detection**
    - Generate tasks with various due dates and completion states; verify overdue flagging logic
    - **Validates: Requirements 5.5**

- [x] 10. Lead scoring engine
  - [x] 10.1 Implement scoring rules and calculation
    - Create `packages/backend/src/modules/scoring/`
    - Implement scoring engine: calculate score from active rules (activity_count, deal_value, stage_progression, email_engagement), clamp to [0, 100]
    - Implement scoring rule CRUD: `GET /api/v1/scoring/rules`, `POST /api/v1/scoring/rules` (Manager/Admin), `PUT /api/v1/scoring/rules/:id`, `DELETE /api/v1/scoring/rules/:id`
    - Recalculate lead score on new activity; record ScoreHistory entry with previous/new score and timestamp
    - Default score of 0 when no rules configured
    - Implement `GET /api/v1/leads/ranked` (sorted by score)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 10.2 Implement score decay with BullMQ cron job
    - Implement `GET /api/v1/scoring/decay`, `PUT /api/v1/scoring/decay` (Manager/Admin)
    - Create BullMQ job `scoreDecay.ts` — runs daily, finds leads with no activity for N days, reduces score by configured amount, clamp to 0
    - Record ScoreHistory entries for decay applications
    - _Requirements: 6.8, 6.9, 6.10, 6.11_

  - [x] 10.3 Write property test for score clamping invariant
    - **Property 15: Lead score clamping invariant**
    - Generate leads with random scoring calculations and decay applications; verify score always in [0, 100]
    - **Validates: Requirements 6.1, 6.11**

  - [x] 10.4 Write property test for scoring recalculation and history
    - **Property 16: Scoring engine recalculation and history**
    - Generate leads with activities and active rules; verify recalculation occurs and ScoreHistory entry created
    - **Validates: Requirements 6.2, 6.4, 6.5**

  - [x] 10.5 Write property test for score decay
    - **Property 17: Score decay reduces inactive lead scores**
    - Generate leads with varying inactivity periods; verify decay reduces score by configured amount, clamped to 0
    - **Validates: Requirements 6.9, 6.11**

- [x] 11. Checkpoint - Ensure scoring and task tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Duplicate detection and lead assignment
  - [x] 12.1 Implement duplicate detection
    - Create `packages/backend/src/modules/duplicates/`
    - Implement `DuplicateDetector.check()` — case-insensitive matching on contact email and company name
    - Integrate into lead creation flow: flag potential duplicates before confirming creation
    - Implement lead merge: `POST /api/v1/leads/:id/merge` — combine activities and contacts from both leads
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 12.2 Write property test for duplicate detection
    - **Property 24: Duplicate detection with case-insensitive matching**
    - Generate leads with varying case email/company names; verify case-insensitive duplicate flagging
    - **Validates: Requirements 10.1, 10.2, 10.7**

  - [x] 12.3 Write property test for lead merge
    - **Property 25: Lead merge combines all data**
    - Generate two leads with activities and contacts; merge and verify all data combined, activity count equals sum
    - **Validates: Requirements 10.5, 10.6**

  - [x] 12.4 Implement assignment rules engine
    - Create `packages/backend/src/modules/assignments/`
    - Implement assignment rule CRUD: `GET /api/v1/assignment-rules`, `POST /api/v1/assignment-rules` (Manager/Admin), `PUT /api/v1/assignment-rules/:id`, `DELETE /api/v1/assignment-rules/:id`
    - Implement `AssignmentEngine.evaluate()` — evaluate rules in priority order (territory, deal_size, round_robin), assign to first matching rule's user
    - If no rule matches, leave unassigned and notify managers
    - Integrate into lead creation flow
    - Allow manual override by Manager/Admin
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 12.5 Write property test for assignment engine priority
    - **Property 26: Assignment engine priority evaluation**
    - Generate leads and sets of active rules with varying priorities; verify highest-priority matching rule wins, unassigned if none match
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5**

- [x] 13. Audit log
  - [x] 13.1 Implement audit logging service
    - Create `packages/backend/src/modules/audit/`
    - Create audit middleware/utility that intercepts create/update/delete on Lead, Contact, Company, StageTransition and creates AuditEntry with user, action, entity type, entity ID, timestamp
    - For updates, record field name, previous value, and new value in `changes` JSON
    - Implement `GET /api/v1/audit` (Admin only) with filters: entity type, user, action type, date range; reverse chronological order
    - Implement `GET /api/v1/leads/:id/audit` for entity-specific audit entries
    - Block all UPDATE/DELETE operations on AuditEntry table (append-only)
    - Retain entries for minimum 365 days
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 13.2 Write property test for audit entry creation
    - **Property 27: Audit entry creation on mutations**
    - Generate create/update/delete operations on entities; verify AuditEntry created with correct user, action, entity, timestamp, and field changes for updates
    - **Validates: Requirements 12.1, 12.2**

  - [x] 13.3 Write property test for audit log immutability
    - **Property 28: Audit log immutability**
    - Attempt to edit/delete AuditEntry records with various user roles; verify all attempts rejected
    - **Validates: Requirements 12.5**

- [ ] 14. Email integration
  - [x] 14.1 Implement email provider adapter and Gmail integration
    - Create `packages/backend/src/modules/email/` with provider-agnostic `EmailProviderAdapter` interface
    - Implement `GmailAdapter` implementing authenticate, refreshToken, syncEmails, sendEmail, validateConfiguration
    - Create `EmailProviderRegistry` that validates adapter implementations before activation
    - Implement OAuth 2.0 flow: `POST /api/v1/email/connect`, `GET /api/v1/email/callback`
    - Store OAuth tokens encrypted in EmailAccount table
    - Handle token expiry: attempt refresh, prompt re-auth if refresh fails
    - _Requirements: 3.1, 3.2, 3.5, 3.7, 3.9_

  - [x] 14.2 Implement email sync and activity logging
    - Create BullMQ job `emailSync.ts` — sync emails from connected accounts, match to contacts linked to leads
    - Auto-log matched emails as Activity type EMAIL on lead timeline with subject and timestamp
    - Implement `POST /api/v1/email/sync` for manual sync trigger
    - Implement `POST /api/v1/leads/:id/email/send` — send email via adapter, log as Activity
    - Retry sync failures up to 3 times with exponential backoff; notify user after exhaustion
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.8_

  - [x] 14.3 Write property test for email-to-activity logging
    - **Property 8: Email-to-activity logging**
    - Generate emails with sender/recipient matching contacts linked to leads; verify Activity of type EMAIL created on correct lead
    - **Validates: Requirements 3.3, 3.4, 3.6**

  - [x] 14.4 Write property test for email provider interface validation
    - **Property 9: Email provider interface validation**
    - Generate objects with varying method implementations; verify registry rejects incomplete adapters and accepts complete ones
    - **Validates: Requirements 3.9**

- [x] 15. Checkpoint - Ensure backend service tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. CSV import and export
  - [x] 16.1 Implement CSV import with field mapping
    - Create `packages/backend/src/modules/csv/`
    - Implement `POST /api/v1/csv/import/upload` — parse CSV, return column headers
    - Implement `POST /api/v1/csv/import/preview` — apply field mapping, return preview of first 5 rows
    - Implement `POST /api/v1/csv/import/execute` — validate rows (require lead name + valid stage), skip invalid rows, run duplicate detection per row, create leads
    - Return import summary: successCount + skipCount = totalRows, with row numbers and error descriptions for skipped rows
    - Reject import if required system field not mapped
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.8, 8.10, 8.11_

  - [x] 16.2 Implement CSV export and field mapping persistence
    - Implement `GET /api/v1/csv/export` — export leads with name, stage, deal value, contact names, company name, score, close date; header row matching field names
    - Implement `GET /api/v1/csv/field-mappings`, `POST /api/v1/csv/field-mappings` for saving/reusing mappings
    - _Requirements: 8.5, 8.6, 8.9_

  - [x] 16.3 Write property test for CSV import validation
    - **Property 21: CSV import validation and summary**
    - Generate CSV data with valid and invalid rows; verify successCount + skipCount = totalRows, skipped rows have row number and error
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [x] 16.4 Write property test for CSV round-trip
    - **Property 22: CSV export-import round-trip**
    - Generate valid leads, export to CSV, import back; verify equivalent lead set
    - **Validates: Requirements 8.7**

- [ ] 17. Search and filtering
  - [x] 17.1 Implement full-text search with PostgreSQL tsvector
    - Create `packages/backend/src/modules/search/`
    - Set up tsvector/tsquery with GIN indexes on Lead (name), Contact (name, email), Company (name) via Prisma raw SQL migration
    - Implement `GET /api/v1/search` — full-text search with filters (stage, score range, date range, assigned user), combinable filters
    - Return results with entity type, name, contextual snippet, and result count
    - Target < 500ms for datasets up to 100K records
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 17.2 Write property test for search and filter correctness
    - **Property 29: Search and filter correctness**
    - Generate search queries with filter combinations; verify all results match query AND all filters, reported count equals actual count
    - **Validates: Requirements 13.1, 13.3, 13.4, 13.5**

  - [x] 17.3 Write property test for search result display
    - **Property 30: Search result display completeness**
    - Generate search results; verify each includes entity type, name, and contextual snippet
    - **Validates: Requirements 13.6**

- [ ] 18. Dashboard and reporting
  - [x] 18.1 Implement dashboard API endpoints
    - Create `packages/backend/src/modules/dashboard/`
    - Implement `GET /api/v1/dashboard/pipeline-value` — total deal value per stage
    - Implement `GET /api/v1/dashboard/conversion-rates` — stage-to-stage conversion rates using StageTransition data
    - Implement `GET /api/v1/dashboard/stage-duration` — average time in each stage
    - Implement `GET /api/v1/dashboard/lead-counts` — lead count per stage
    - Implement `GET /api/v1/dashboard/closed-summary` — closed won/lost counts
    - All endpoints support date range filtering
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 18.2 Write property test for pipeline value aggregation
    - **Property 18: Dashboard pipeline value aggregation**
    - Generate leads with deal values across stages; verify per-stage sums and total pipeline value
    - **Validates: Requirements 7.1**

  - [x] 18.3 Write property test for conversion rate calculation
    - **Property 19: Dashboard conversion rate calculation**
    - Generate stage transitions; verify conversion rate = leads transitioned / leads entered for consecutive stage pairs
    - **Validates: Requirements 7.2**

  - [x] 18.4 Write property test for stage duration calculation
    - **Property 20: Dashboard stage duration calculation**
    - Generate leads with stage transitions; verify average duration = mean of (exit - entry) timestamps
    - **Validates: Requirements 7.3**

- [x] 19. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 20. Frontend - Layout and routing
  - [x] 20.1 Set up React app shell with routing
    - Create `packages/frontend/src/App.tsx` with React Router, TanStack Query provider
    - Create layout components: shell, sidebar navigation, header with user menu
    - Set up Tailwind CSS and Shadcn/ui theme
    - Create API client utility with JWT auth header injection
    - Set up route structure: `/login`, `/dashboard`, `/pipelines`, `/leads`, `/leads/:id`, `/contacts`, `/companies`, `/tasks`, `/settings`
    - _Requirements: All (frontend foundation)_

- [ ] 21. Frontend - Pipeline and lead views
  - [x] 21.1 Implement pipeline Kanban board view
    - Create `packages/frontend/src/components/pipeline/` with Kanban board showing leads grouped by stage
    - Implement drag-and-drop stage transitions (triggers `POST /api/v1/leads/:id/move`)
    - Display lead cards with name, deal value, score, assigned user
    - Implement pipeline selector and stage reordering UI
    - _Requirements: 1.2, 1.3, 1.5_

  - [x] 21.2 Implement lead detail view and forms
    - Create `packages/frontend/src/components/leads/` with lead creation form (name required, description, deal value, stage, company)
    - Implement lead detail page: info panel, activity timeline, linked contacts, tasks, audit log tab
    - Implement stage transition UI with closed stage handling
    - Show duplicate detection warnings on lead creation
    - _Requirements: 1.1, 1.6, 1.7, 2.4, 2.5, 4.1, 10.3, 10.4_

- [ ] 22. Frontend - Contacts, companies, and activities
  - [x] 22.1 Implement contact and company views
    - Create `packages/frontend/src/components/contacts/` with contact list, create/edit forms
    - Create `packages/frontend/src/components/companies/` with company list, detail view (showing leads and contacts), create/edit forms
    - Implement company deletion confirmation dialog for companies with associated leads
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7_

  - [x] 22.2 Implement activity timeline and file attachments UI
    - Create `packages/frontend/src/components/activities/` with timeline component (reverse chronological)
    - Implement activity logging forms for Call, Meeting, Note types
    - Implement activity type filter
    - Implement file upload with 25MB validation, file list with download/preview links
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10, 4.11_

- [ ] 23. Frontend - Tasks, scoring, and email
  - [x] 23.1 Implement task management UI
    - Create `packages/frontend/src/components/tasks/` with task list (sorted by due date), create/edit forms
    - Implement task completion toggle, overdue visual highlighting, reassignment UI
    - Validate due date required on creation
    - _Requirements: 5.1, 5.4, 5.5, 5.6, 5.7_

  - [x] 23.2 Implement lead scoring UI
    - Create `packages/frontend/src/components/scoring/` with score display on lead cards and detail view
    - Implement scoring rule configuration UI (Manager/Admin only)
    - Implement score decay configuration UI
    - Implement ranked lead list view sorted by score
    - _Requirements: 6.1, 6.3, 6.6, 6.8_

  - [x] 23.3 Implement email integration UI
    - Implement Gmail OAuth connect flow in settings
    - Implement email compose/send from lead detail view
    - Display synced emails in activity timeline
    - Show re-authentication prompt on token expiry
    - Show error notification on sync failure after retries
    - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8_

- [ ] 24. Frontend - Dashboard, CSV, search, and admin
  - [x] 24.1 Implement dashboard view
    - Create `packages/frontend/src/components/dashboard/` with metric cards and charts
    - Display pipeline value by stage, conversion rates, average stage duration, lead counts, closed won/lost summary
    - Implement date range filter
    - Refresh data on navigation to dashboard
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 24.2 Implement CSV import/export UI
    - Create `packages/frontend/src/components/csv/` with import wizard: file upload → field mapping interface → preview (first 5 rows) → execute
    - Display import summary with success/skip counts and error details
    - Implement export button triggering CSV download
    - Implement saved field mapping selection and save
    - Show validation error if required field not mapped
    - _Requirements: 8.1, 8.4, 8.5, 8.8, 8.9, 8.10, 8.11_

  - [x] 24.3 Implement search and filtering UI
    - Create `packages/frontend/src/components/search/` with search bar, filter panel (stage, score range, date range, assigned user)
    - Display results with entity type, name, contextual snippet, and result count
    - Implement clear filters to return to default view
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [x] 24.4 Implement audit log and admin views
    - Create `packages/frontend/src/components/audit/` with audit log table (Admin only), filters by entity type, user, action, date range
    - Display entity-specific audit entries on lead/contact/company detail views
    - Implement user management UI (Admin): user list, role assignment
    - Implement assignment rule configuration UI (Manager/Admin)
    - _Requirements: 9.4, 9.6, 11.1, 11.7, 12.3, 12.6, 12.7_

- [x] 25. Checkpoint - Ensure frontend builds and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 26. Final integration and wiring
  - [x] 26.1 Wire all backend modules together
    - Register all Fastify route plugins in `app.ts`
    - Ensure middleware chain: auth → RBAC → route handler → audit logging
    - Wire lead creation flow: validation → duplicate check → assignment engine → scoring → audit
    - Wire activity creation flow: log activity → recalculate score → update lastActivityAt → audit
    - Wire task completion flow: mark complete → log activity on lead → audit
    - Verify all BullMQ jobs registered: emailSync, scoreDecay, taskReminder
    - _Requirements: All_

  - [x] 26.2 Write integration tests for end-to-end flows
    - Test lead lifecycle: create → assign → add activities → score → move stages → close
    - Test CSV import → duplicate detection → lead creation → assignment
    - Test email sync → activity logging → score recalculation
    - Use Fastify `inject()` and test database
    - _Requirements: All_

- [x] 27. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (Properties 1-30)
- All dependency versions follow `.kiro/steering/tech-stack-versions.md`
- Backend uses Fastify ^5.x with TypeScript ~5.7.x, Prisma ^7.x, BullMQ ^5.71+
- Frontend uses React ^19.2.x, TanStack Query ^5.x, Tailwind CSS ^4.2.x
- Testing uses Vitest ^3.x and fast-check ^3.x
