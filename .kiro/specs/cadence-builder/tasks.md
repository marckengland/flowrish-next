# Implementation Plan: Cadence Builder

## Overview

Incremental implementation of the Cadence Builder feature: data models first, then backend service/routes, BullMQ worker, conditional exit hooks, frontend pages/components, and finally integration wiring. All code is TypeScript across the Prisma/Fastify backend and React frontend.

## Tasks

- [x] 1. Add Prisma schema models and generate migration
  - [x] 1.1 Add CadenceStatus, ActionType, and EnrollmentStatus enums to `packages/backend/prisma/schema.prisma`
    - Add the three new enums as defined in the design data models section
    - _Requirements: 1.1, 2.1, 3.1_

  - [x] 1.2 Add Cadence, CadenceStep, CadenceEnrollment, and StepExecutionLog models to `packages/backend/prisma/schema.prisma`
    - Add all four models with fields, relations, indexes, and unique constraints as specified in the design
    - Add `cadencesCreated` and `enrollmentsCreated` relations to the User model
    - Add `cadenceEnrollments` relation to the Lead model
    - _Requirements: 1.1, 2.1, 3.1, 4.2_

  - [x] 1.3 Generate and apply Prisma migration
    - Run `npx prisma migrate dev --name add_cadence_models` to create and apply the migration
    - Verify the generated migration SQL matches the expected schema
    - _Requirements: 1.1, 2.1, 3.1, 4.2_

- [x] 2. Create cadence backend module with CRUD service and routes
  - [x] 2.1 Create `packages/backend/src/modules/cadences/cadence.types.ts` with input/output type definitions
    - Define CreateCadenceInput, UpdateCadenceInput, CreateStepInput, UpdateStepInput, ReorderStepInput, EnrollLeadInput, BulkEnrollInput, CadenceWithMetrics, CadenceDetail, EnrollmentWithLead, CadenceAnalytics types
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 7.1_

  - [x] 2.2 Create `packages/backend/src/modules/cadences/cadence.service.ts` with cadence CRUD methods
    - Implement createCadence: validate non-empty name, create with DRAFT status, associate createdById
    - Implement listCadences: return all cadences with step count and enrollment metrics, ordered by createdAt descending
    - Implement getCadenceById: return cadence with steps (ordered by stepOrder) and enrollment summary
    - Implement updateCadence: validate status transitions (DRAFT→ACTIVE requires ≥1 step, ACTIVE→ARCHIVED exits all active enrollments)
    - Implement deleteCadence: reject if active enrollments exist, otherwise delete
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 2.3 Write property tests for cadence CRUD in `packages/backend/src/modules/cadences/__tests__/cadence-crud.property.test.ts`
    - **Property 1: Cadence creation defaults to DRAFT**
    - **Validates: Requirements 1.1**

  - [x] 2.4 Write property tests for cadence list ordering
    - **Property 2: Cadence list ordering**
    - **Validates: Requirements 1.2**

  - [x] 2.5 Write property tests for deletion blocked by active enrollments
    - **Property 4: Deletion blocked by active enrollments**
    - **Validates: Requirements 1.4, 1.5**

  - [x] 2.6 Write property tests for activation requires at least one step
    - **Property 5: Activation requires at least one step**
    - **Validates: Requirements 1.6**

  - [x] 2.7 Write property tests for archiving exits all active enrollments
    - **Property 6: Archiving exits all active enrollments**
    - **Validates: Requirements 1.7**

- [x] 3. Implement step management service methods
  - [x] 3.1 Add step management methods to `cadence.service.ts`
    - Implement addStep: validate actionType and delayHours ≥ 0, reject if cadence is ARCHIVED, enforce append-only for ACTIVE cadences with enrollments
    - Implement updateStep: validate inputs, reject for ARCHIVED cadences
    - Implement removeStep: remove step and re-number remaining steps contiguously from 1, reject for ARCHIVED cadences or ACTIVE cadences with enrollments
    - Implement reorderSteps: accept a permutation of step IDs with new orders, validate set preservation, reject for ARCHIVED cadences or ACTIVE cadences with enrollments
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 3.2 Write property tests for step management in `packages/backend/src/modules/cadences/__tests__/cadence-steps.property.test.ts`
    - **Property 8: Step validation**
    - **Validates: Requirements 2.1**

  - [x] 3.3 Write property tests for step removal re-numbering
    - **Property 9: Step removal re-numbers contiguously**
    - **Validates: Requirements 2.4**

  - [x] 3.4 Write property tests for step reorder preserves set
    - **Property 10: Step reorder preserves set and persists order**
    - **Validates: Requirements 2.5, 2.6**

  - [x] 3.5 Write property tests for archived cadence rejects step modifications
    - **Property 11: Archived cadence rejects step modifications**
    - **Validates: Requirements 2.7**

  - [x] 3.6 Write property tests for active cadence with enrollments restricts step mutations
    - **Property 12: Active cadence with enrollments restricts step mutations**
    - **Validates: Requirements 2.8**

- [x] 4. Implement enrollment service methods
  - [x] 4.1 Add enrollment methods to `cadence.service.ts`
    - Implement enrollLead: validate cadence is ACTIVE, reject duplicate active enrollment, enforce TEAM_MEMBER lead assignment check, create enrollment with ACTIVE status and currentStepOrder=1, schedule first step job
    - Implement bulkEnroll: enroll multiple leads in a single operation with same validations
    - Implement pauseEnrollment: validate enrollment is ACTIVE, set to PAUSED, cancel pending BullMQ jobs
    - Implement resumeEnrollment: validate enrollment is PAUSED, set to ACTIVE, schedule next due step
    - Implement exitEnrollment: validate enrollment is ACTIVE or PAUSED, set to EXITED, cancel pending jobs
    - Implement listEnrollments: return enrollments with lead name, current step, status, dates, exit reason
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 4.2 Write property tests for enrollment in `packages/backend/src/modules/cadences/__tests__/cadence-enrollment.property.test.ts`
    - **Property 13: Enrollment initialization**
    - **Validates: Requirements 3.1**

  - [x] 4.3 Write property tests for duplicate enrollment rejection
    - **Property 14: Duplicate active enrollment rejection**
    - **Validates: Requirements 3.2**

  - [x] 4.4 Write property tests for TEAM_MEMBER lead assignment enforcement
    - **Property 15: TEAM_MEMBER lead assignment enforcement**
    - **Validates: Requirements 3.3, 9.3, 9.4**

  - [x] 4.5 Write property tests for enrollment status transitions
    - **Property 16: Enrollment status transitions — pause**
    - **Property 17: Enrollment status transitions — resume**
    - **Property 18: Enrollment status transitions — exit**
    - **Validates: Requirements 3.6, 3.7, 3.8**

  - [x] 4.6 Write property tests for bulk enrollment count
    - **Property 19: Bulk enrollment count**
    - **Validates: Requirements 3.9**

  - [x] 4.7 Write property test for non-ACTIVE cadence rejects enrollment
    - **Property 20: Non-ACTIVE cadence rejects enrollment**
    - **Validates: Requirements 3.10**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Create cadence routes and RBAC enforcement
  - [x] 6.1 Create `packages/backend/src/modules/cadences/cadence.routes.ts` with all 14 API endpoints
    - Implement POST/GET/PUT/DELETE for cadence CRUD under `/api/v1/cadences`
    - Implement POST/PUT/DELETE for step management under `/api/v1/cadences/:id/steps`
    - Implement POST/GET for enrollment management under `/api/v1/cadences/:id/enrollments`
    - Implement PUT/DELETE for enrollment actions under `/api/v1/enrollments/:id`
    - Implement GET for analytics under `/api/v1/cadences/:id/analytics`
    - Add RBAC middleware: ADMIN/MANAGER for cadence/step mutations, all authenticated for reads and enrollment actions
    - Enforce TEAM_MEMBER restrictions on enrollment operations (assigned leads only)
    - _Requirements: 1.9, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 6.2 Create `packages/backend/src/modules/cadences/index.ts` barrel export and register routes in `packages/backend/src/app.ts`
    - Export cadenceRoutes from index.ts
    - Import and register cadenceRoutes in app.ts
    - _Requirements: 1.1, 8.1_

  - [x] 6.3 Write property tests for RBAC mutation rejection
    - **Property 7: RBAC mutation rejection**
    - **Validates: Requirements 1.9, 9.5**

- [x] 7. Implement BullMQ cadence execution worker
  - [x] 7.1 Add `CADENCE_EXECUTION` to QueueName in `packages/backend/src/common/config/queue.ts` and add queue defaults
    - Add `CADENCE_EXECUTION: 'cadence-execution'` to QueueName
    - Add default job options: 3 attempts, exponential backoff starting at 5000ms, removeOnComplete 500, removeOnFail 1000
    - _Requirements: 4.1, 4.5_

  - [x] 7.2 Create `packages/backend/src/jobs/cadenceExecution.ts` worker
    - Implement createCadenceExecutionWorker with concurrency 10
    - Worker job handler: load enrollment, verify ACTIVE status, check conditional exits before executing, call cadenceService.executeStep
    - Handle stale jobs (enrollment no longer ACTIVE, step mismatch) as no-op
    - _Requirements: 4.1, 4.7, 6.4_

  - [x] 7.3 Implement executeStep method in `cadence.service.ts`
    - For EMAIL actionType: send email via enrolling user's EmailAccount to lead's primary contact email using step template; if no EmailAccount, create notification Task and pause enrollment
    - For CALL actionType: create Task with title "Call: {lead name}"
    - For LINKEDIN actionType: create Task with title "LinkedIn: {lead name}"
    - For MANUAL_TASK actionType: create Task with step's configured title and description
    - Create Activity record on lead with appropriate ActivityType (EMAIL, CALL, or NOTE)
    - Create StepExecutionLog with outcome
    - Advance enrollment to next step and schedule delayed job, or mark COMPLETED if final step
    - On exhausted retries: set enrollment to PAUSED, create failure notification Task
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 7.4 Register cadence execution worker in `packages/backend/src/jobs/index.ts`
    - Import createCadenceExecutionWorker and add to workers array in startWorkers
    - _Requirements: 4.1_

  - [x] 7.5 Write property tests for step execution in `packages/backend/src/modules/cadences/__tests__/cadence-execution.property.test.ts`
    - **Property 21: Step execution creates log**
    - **Validates: Requirements 4.2**

  - [x] 7.6 Write property tests for step advancement and completion
    - **Property 22: Step advancement**
    - **Property 23: Final step completes enrollment**
    - **Validates: Requirements 4.3, 4.4**

  - [x] 7.7 Write property tests for non-EMAIL step task creation
    - **Property 27: Non-EMAIL step creates correctly titled task**
    - **Validates: Requirements 5.2, 5.3, 5.4**

- [x] 8. Implement conditional exit hooks
  - [x] 8.1 Add handleReplyDetected and handleMeetingBooked methods to `cadence.service.ts`
    - handleReplyDetected: find active enrollments for the lead, set to EXITED with exitReason "reply_detected", cancel pending jobs, create StepExecutionLog
    - handleMeetingBooked: find active enrollments for the lead, set to EXITED with exitReason "meeting_booked", cancel pending jobs, create StepExecutionLog
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.2 Hook reply detection into `packages/backend/src/jobs/emailSync.ts`
    - After syncing inbound emails, call cadenceService.handleReplyDetected(leadId, fromEmail) for each inbound message from a contact associated with an enrolled lead
    - _Requirements: 6.1_

  - [x] 8.3 Hook meeting detection into `packages/backend/src/modules/activities/activity.service.ts`
    - After creating a MEETING activity, call cadenceService.handleMeetingBooked(leadId)
    - _Requirements: 6.2_

  - [x] 8.4 Write property tests for conditional exits in `packages/backend/src/modules/cadences/__tests__/cadence-execution.property.test.ts`
    - **Property 29: Conditional exit on qualifying event**
    - **Validates: Requirements 6.1, 6.2**

- [x] 9. Implement analytics service method
  - [x] 9.1 Add getCadenceAnalytics method to `cadence.service.ts`
    - Compute total, active, completed, exited enrollment counts per cadence
    - Compute completion rate (completed / total * 100)
    - Compute average time to completion for completed enrollments
    - Compute per-step metrics: reached count, completed count, exited count
    - Use aggregate queries as specified in the design analytics query strategy
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 9.2 Write property tests for analytics in `packages/backend/src/modules/cadences/__tests__/cadence-analytics.property.test.ts`
    - **Property 31: Cadence-level analytics correctness**
    - **Validates: Requirements 7.1, 7.3**

  - [x] 9.3 Write property tests for per-step analytics
    - **Property 32: Per-step analytics correctness**
    - **Validates: Requirements 7.2**

- [x] 10. Checkpoint — Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Create frontend API client and types
  - [x] 11.1 Create `packages/frontend/src/api/cadences.ts` with API client functions
    - Implement functions for all 14 cadence API endpoints using the existing fetch/axios pattern
    - Define TypeScript types mirroring the backend response shapes
    - _Requirements: 1.1, 2.1, 3.1, 7.1_

- [x] 12. Build CadencesPage (list page)
  - [x] 12.1 Create `packages/frontend/src/components/cadences/CadenceStatusBadge.tsx`
    - Render DRAFT/ACTIVE/ARCHIVED status as colored badges using shadcn/ui Badge component
    - _Requirements: 8.2_

  - [x] 12.2 Create `packages/frontend/src/components/cadences/CadenceList.tsx`
    - Searchable, sortable table showing cadence name, status badge, step count, active enrollments, completion rate
    - Include "New Cadence" button (visible only for ADMIN/MANAGER roles)
    - _Requirements: 1.2, 1.8, 8.2, 9.1, 9.2_

  - [x] 12.3 Create `packages/frontend/src/components/cadences/CadenceForm.tsx`
    - Modal dialog for creating/editing cadence name
    - _Requirements: 1.1, 1.3, 8.3_

  - [x] 12.4 Create `packages/frontend/src/pages/CadencesPage.tsx`
    - Compose CadenceList and CadenceForm components
    - Fetch cadences using react-query
    - _Requirements: 8.2_

- [x] 13. Build CadenceDetailPage with step builder
  - [x] 13.1 Create `packages/frontend/src/components/cadences/StepCard.tsx`
    - Display step order number, ActionType icon (using Lucide icons), delay label, and template preview for EMAIL steps
    - _Requirements: 2.3, 8.4_

  - [x] 13.2 Create `packages/frontend/src/components/cadences/StepEditor.tsx`
    - Inline editor panel for modifying step ActionType, delay, email subject/body, task title/description
    - Show/hide email template fields based on ActionType selection
    - _Requirements: 2.1, 2.2, 8.5_

  - [x] 13.3 Create `packages/frontend/src/components/cadences/StepTimeline.tsx`
    - Vertical timeline layout rendering StepCard components in order
    - Support drag-and-drop reordering (disabled for ACTIVE cadences with enrollments and ARCHIVED cadences)
    - Include "Add Step" button at the bottom
    - _Requirements: 2.3, 2.5, 2.7, 2.8, 8.4_

  - [x] 13.4 Create `packages/frontend/src/components/cadences/EnrollmentTable.tsx`
    - Table showing enrolled leads with name, current step number, status, enrollment date, exit reason
    - Include pause/resume/remove actions per enrollment (respecting RBAC)
    - _Requirements: 3.5, 6.3, 8.6, 9.2, 9.4_

  - [x] 13.5 Create `packages/frontend/src/components/cadences/EnrollLeadDialog.tsx`
    - Dialog for searching and selecting leads to enroll (single or bulk)
    - Filter to show only assigned leads for TEAM_MEMBER role
    - _Requirements: 3.1, 3.3, 3.4, 3.9, 9.3_

  - [x] 13.6 Create `packages/frontend/src/components/cadences/StepMetricsBar.tsx` and `packages/frontend/src/components/cadences/AnalyticsPanel.tsx`
    - StepMetricsBar: per-step metric visualization (reached, completed, exited counts)
    - AnalyticsPanel: cadence-level metrics display (total, active, completed, exited, completion rate, avg completion time)
    - _Requirements: 7.1, 7.2, 7.3, 8.7_

  - [x] 13.7 Create `packages/frontend/src/pages/CadenceDetailPage.tsx`
    - Tabbed layout with "Steps", "Enrollments", and "Analytics" tabs
    - Steps tab: StepTimeline with StepEditor, cadence name/status header with edit/activate/archive controls
    - Enrollments tab: EnrollmentTable with EnrollLeadDialog trigger
    - Analytics tab: AnalyticsPanel with StepMetricsBar per step
    - Show/hide mutation controls based on user role
    - _Requirements: 1.1, 1.3, 1.6, 1.7, 8.4, 8.5, 8.6, 8.7, 9.1, 9.2_

- [x] 14. Wire frontend routing and navigation
  - [x] 14.1 Add cadence routes to `packages/frontend/src/App.tsx`
    - Add `/cadences` route pointing to CadencesPage
    - Add `/cadences/:id` route pointing to CadenceDetailPage
    - _Requirements: 8.1_

  - [x] 14.2 Add "Cadences" nav item to `packages/frontend/src/components/layout/Sidebar.tsx`
    - Add `{ to: "/cadences", label: "Cadences", icon: Zap }` between "Tasks" and "CSV Import/Export"
    - Import Zap from lucide-react
    - _Requirements: 8.1, 8.8_

- [x] 15. Checkpoint — Ensure all tests pass and frontend compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Write unit tests for cadence module
  - [x] 16.1 Create `packages/backend/src/modules/cadences/__tests__/cadence.test.ts` with unit tests
    - Test cadence CRUD: create with valid/invalid names, status transitions, delete with/without enrollments
    - Test step management: add/remove/reorder, re-numbering, archived cadence rejection, active cadence restrictions
    - Test enrollment: enroll/pause/resume/exit, duplicate rejection, RBAC enforcement
    - Test action execution: email sending (mocked), task creation for CALL/LINKEDIN/MANUAL_TASK
    - Test conditional exits: reply detection, meeting booked detection
    - Test analytics: known data sets with expected metric outputs
    - Test all error scenarios from the design error handling table
    - _Requirements: 1.1–1.9, 2.1–2.8, 3.1–3.10, 4.1–4.8, 5.1–5.6, 6.1–6.4, 7.1–7.4, 9.1–9.5_

- [x] 17. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (32 properties)
- Unit tests validate specific examples and edge cases
- Backend is fully implemented before frontend to enable API-driven development
