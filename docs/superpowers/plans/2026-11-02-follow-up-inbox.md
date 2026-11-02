# Reply detection and follow-up approval inbox

User authorized completion, testing and merge. No dependency additions. Use existing Next/Prisma/Inngest UI.

## Task 1: Reply detection and persistent inbox backend
Implement normalized incoming-reply detection in both Gmail/Microsoft sync paths. Only genuine inbound replies in an active enrollment's existing thread, after enrollment, from lead primary/alternate email to the connected mailbox should stop cadences. Ignore outbound, auto responses, bounces and ambiguous lead matches. Scope mailbox/provider message identity and retry recovery so a failed processing step can run again without duplicate activities/suggestions. Pending and active sequences must stop before any subsequent send; check executor guard. Avoid interpreting old unrelated mail as a reply.

Persistent FollowUpSuggestion with organizationId, assigneeId (mailbox owner), leadId, sourceKey unique within org, sourceType EMAIL/CALL, sourceId, sourceText, title, description, draftSubject, draftBody, status PENDING/APPROVED/DISMISSED, taskId?, createdAt/updatedAt. Additive migration with RLS/revoked browser role access and tenant middleware. Incoming matched replies create one suggestion alongside cadence stopping. Receptionist captures already create tasks: surface those as call suggestions referencing existing task, don't duplicate or change existing callback contract. Existing call history may be lazily materialized on inbox load, scoped to valid assignee/tasks.

API GET /api/follow-ups -> {data: FollowUpItem[]} scoped to user's assigned suggestions, latest 100, status query optional default PENDING. Require leads:read. Item includes id, sourceType, sourceText, title, description, draftSubject, draftBody, status, taskId, lead:{id,firstName,lastName,email}, createdAt. PATCH /api/follow-ups/[id] with {action:'approve'|'dismiss', title?,description?,dueDate? ISO}. Require leads:write and read. Scope assigned user and org. Approve editable task atomically exactly once; already-linked call task retained. Dismiss creates nothing. Reject invalid/deleted lead and invalid assignee. Preserve history and audit mutations. Drafts are plain text starting templates, no AI dependency or implicit send. No outbound mail from approval endpoint.

## Task 2: UI
/follow-ups authenticated page, sidebar link gated leads:read. Pending/approved/dismissed tabs, loading/empty/error states, cards with source, lead link, editable title/description/due date, approve task and dismiss. Open approved task. Draft email button opens existing EmailCompose with safe HTML-escaped plain draft and source thread only if valid; explicit send in composer. Permission/read-only controls. Component tests for approval edited values, dismiss, errors, no implicit send, loading, empty. Align existing design, responsive accessible labels.

## Task 3: Verify and integrate
Tests first for behavior; no existing test changes without approval if wrong. Narrow then full tests, lint --fix, typecheck, build. Disposable PostgreSQL migration and concurrency verification. Browser read-only and local synthetic UI verification. Independent review, fix findings. Rollback retains additive table/history, revert code; no DB restore/drop. Merge locally after checks. Push authorization from prior session applies to completed feature/deployment but verify before remote action if scope unclear.

Ruling: stable deterministic draft templates first, exposing source text without claiming full email content. Full email retrieval/AI extraction deferred; short preview is labeled accordingly. This makes nuanced automatic drafts harder until full-content retrieval is implemented.

## Completion evidence
- Baseline: 962 tests passed.
- UI: 12 component tests passed; approved/dismissed history, edits, errors, accessibility, safe drafts and read-only controls.
- Disposable PostgreSQL: 9 inbox tests passed including concurrent approval/reconciliation, rollback, tenant/assignee boundaries, existing callback reuse, and repeated enrollment exits. Existing receptionist integration: 4 tests passed.
- Browser suite against compiled local production app: 23 passed, 4 pre-existing guarded navigation tests skipped. New inbox checks all passed; synthetic approval is intercepted and sends no email.
- Both forward migrations applied successfully; baseline customer counts unchanged. Inbox RLS and browser privilege revocations verified.
- Independent review corrected mailbox identity on sent and legacy messages, per-user callback scan limits/reassignment, queued cadence status guard, and terminal enrollment uniqueness.
- Drafts use labeled previews/templates; continuous mailbox webhooks, full email retrieval and live outbound sends are not tested or implemented in this feature.
