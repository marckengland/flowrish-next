# Bulk Follow-up Approval Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline with one fresh whole-branch review at the end.

**Goal:** Review and approve up to 20 loaded pending follow-ups, preserving inbox filters and unsent drafts and preventing duplicate tasks after uncertain saves.

**Architecture:** Reuse single-item approval transactions and the bulk-snooze fail-stop pattern. New scoped approval preview/confirmation endpoints freeze source/task versions; exact request receipts live in existing AuditEntry records, written atomically with approval. No schema change. Existing callback tasks keep their details and deadlines; newly created tasks stay assigned to the reviewer, with editable title, description and due date.

**Tech Stack:** Existing Next.js, React, Zod, Prisma and PostgreSQL. No dependencies.

**Spec:** User-approved chat description: select pending follow-ups, review task titles/owners/due dates, explicitly confirm, show per-item outcomes, prevent duplicate retries, preserve filters and unsent drafts.

## Global Constraints

- Keep the widget off; no DeepSeek, real emails, authenticated production test writes or new dependencies.
- Retain every existing test assertion/scenario. Ask before correcting a wrong fixture or expectation.
- Use current workspace/account and fresh lead-read/write permission checks, current source/task ownership, canonical row locks and the existing write-pause policy.
- Existing task/card edits are preserved. Edited cards must be resolved before inclusion; approval review uses separate explicit fields.
- No bulk reassignment, no auto-send, no automatic mutation retry, no transaction spanning the whole batch.

## Review Focus

1. A committed approval loses its response: GET must prove this exact request without creating another task.
2. Callback task deadline/owner/source changes after preview: confirmation must reject and preserve existing work.
3. A stale account, revoked permission or malformed/wrong receipt: stop remaining items and clear inaccessible data.
4. Focus refresh, filters, page loading and in-flight editor changes: keep unsent drafts mounted and invalidate stale reviewed batches.
5. Concurrent approvals/replays, an audit failure, reused request identifiers and cross-workspace access: no duplicate task or partial approval.

### Task 1: Scoped preview and durable per-item confirmation

**Files:** new src/lib/follow-up-approval.ts, src/server/services/follow-up-approval.ts and follow-up-approval-guard.ts, src/app/api/follow-ups/[id]/approval/route.ts; extend src/server/services/follow-ups.ts only for an optional internal reviewed-approval guard. Add focused contract/service/HTTP tests.
**Interfaces:** approval input {requestId,expectedVersion,assigneeId,title,description,dueDate}; GET preview returns current source version, lead label and existing-task details; POST confirms; GET with requestId returns confirmed/changed/not-recorded receipt. Existing single-item API remains unchanged.
- [ ] Write and observe failing contract, service and HTTP tests for normalization, bounds, privacy, source/task/permission races, exact idempotency and callback preservation.
- [ ] Implement minimal shared schemas, guarded transaction hooks and read-only receipt verification.
- [ ] Run narrow tests, then existing approval/access/history tests without modifying their assertions.

### Task 2: Reviewed batch runner and inbox controls

**Files:** new src/lib/follow-up-bulk-approval.ts and src/components/follow-ups/follow-up-bulk-approval.tsx with tests; integrate into follow-up-inbox.tsx.
**Interfaces:** bounded sequential preview/confirm/check-results runners with scope fences and exact receipt validation; existing selection/retention and busy callbacks retain selected items and all open drafts.
- [ ] Write failing tests for frozen reviewed payloads, no writes before confirmation, uncertain-result GET-only verification, fail-stop behavior, stale selection/scope and duplicate-proof retries.
- [ ] Implement expandable accessible controls, editable new-task review and immutable callback task review. Dirty card edits block inclusion, not snoozing.
- [ ] Test keeping mounted email drafts/task edits/current filters during preview, approval, partial failure and refresh.

### Task 3: Full verification, recovery and release

**Files:** new six-case mocked browser spec; extend approved rehearsal total148→154; recovery note; disposable PostgreSQL drill in this plan's scratch directory.
- [ ] Exercise desktop/mobile, review/confirmation, cross-scope denial, wrong/stale versions, uncertain receipts, existing callbacks and no live requests in six guarded scenarios; retain all148 previous cases.
- [ ] Run npm test, npm run lint, npm run build, then npx tsc --noEmit and npm run typecheck:fast; run npm run test:receptionist:mocked.
- [ ] Run real-service synthetic PostgreSQL tests for concurrent approvals/replay, audit failure rollback, ownership/permission changes, unchanged sources/deadlines and exact no-extra-work counts. No root prisma db push.
- [ ] Run one fresh whole-branch review, fix confirmed issues RED→GREEN and rerun affected/full checks. Merge/push authorized work and verify exact-commit CI, deployment and anonymous privacy/widget state.

Recovery: revert application changes; keep deliberately approved tasks and audit records. Existing follow-up write-pause policy can stop mutations during recovery. No destructive data undo. This approach makes team reassignment a separate action and requires a new review after a partial batch.
