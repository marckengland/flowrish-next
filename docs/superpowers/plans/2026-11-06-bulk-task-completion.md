# Bulk Approved task completion implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, test-first, with one final fresh whole-change review.

**Goal:** Complete selected Approved CRM tasks after reviewing the exact tasks and explicitly confirming, with safe partial results and preserved inbox state.

**Architecture:** Reuse the existing task-completion preview, POST, exact-request GET receipt, permission checks, and audit transaction. Add a bounded client queue and focused component. Keep Approved selection and review retention separate from Pending bulk approval/snooze. Stop on the first failure; uncertain writes are checked with GET, never automatically resubmitted.

**Tech Stack:** Existing React, Next.js, Zod, Vitest, Playwright, Prisma/PostgreSQL. No new packages or migrations.

**Spec:** The approved in-chat description: select multiple tasks, review the exact list, explicitly confirm; individual outcomes, duplicate protection, filters/order/pages/drafts retained; mocks only, widget off, no DeepSeek or real emails.

## Global constraints

- Up to20 loaded Approved follow-ups, with one occurrence of each linked task. Only Open/Overdue authorized tasks are eligible.
- Preview and verification are GET-only. Confirmation uses the existing per-task endpoint sequentially with frozen task ID, review version, and unique request ID.
- Results: completed, verified, failed, unconfirmed, not-attempted, not-recorded. Stop queued writes on failure, stale account/business, unmount, or changed selection/task.
- No automatic retry or continuation. Checking uncertain results never completes unattempted tasks. A new attempt requires a fresh review and confirmation.
- Retain keyed drafts, filters, personal saved order, pagination, selections and open reviews during access-safe reads and sort changes. Other navigation requires explicit acknowledgment while completion review/results are open.
- No task/schema/server API changes beyond confirmed fixes. No provider calls, real emails, public widget activation, dependencies, or production test writes.
- Keep every existing test/assertion and all184 browser scenarios; add6scenarios for a total190.

## Review focus

- Duplicate follow-ups pointing at one task must not generate repeated completion attempts or audit/activity writes.
- Lost or mismatched receipts must stop the queue and allow only exact-request GET verification.
- A task edited, completed, reassigned or made inaccessible after review must not be completed from a stale snapshot.
- Read-only/stale-account responses and delayed responses after navigation must stop work and redact private review details.
- Keyed composers, current order/filters and retained reviews must survive partial completion and reads; single-task rescheduling/completion must not race the batch.

## Task1: Bounded completion queue

**Files:** Create `src/lib/follow-up-bulk-task-completion.ts` and its test.
**Interfaces:** `makeBulkTaskCompletionPlan(raw)`, `previewBulkTaskCompletion(ids,context,hooks)`, `runBulkTaskCompletion(plan,context,hooks)`, `verifyBulkTaskCompletion(plan,previous,context,hooks)`. Export item eligibility/list-key helpers and20limit. Consume existing completion schemas/scoped client response decoder.

- [x] Write/run failing tests for selection bounds/uniqueness, duplicate task IDs, GET-only reviews, sequential frozen POSTs, exact task/request receipts, partial failure/uncertainty, GET-only verification, and scope/permission/current-selection/abort fences.
- [x] Implement the bounded queue with per-request timeout and unchanged single-task endpoints. Verify only attempted failed/unconfirmed requests; leave unattempted tasks untouched.
- [x] Run the narrow queue tests; retain existing completion service/route coverage.

## Task2: Approved review and retained selection

**Files:** Create `src/components/follow-ups/follow-up-bulk-task-completion.tsx`; modify `follow-up-inbox.tsx`; add focused component/inbox tests.
**Interfaces:** Controlled selected IDs, blocked IDs, current items/context, busy and review-hold callbacks, existing confirmed task receipt callback and access invalidation. Parent keeps selected/review IDs in retained reads.

- [x] Write/run failing tests for select/review/confirm, manager assignee display, duplicate exclusion, partial results/check-only behavior, current-permission redaction, stale reviews, and selection/navigation races.
- [x] Add explicit task review, assignee/lead/deadline details, confirm and cancel, per-item results and exact-request check. Keep action/review result holds separate from Pending actions and single-card task actions.
- [x] Preserve original composer nodes during completion, sort-only change and pagination; guard navigation and single-task mutations while batch review/results remain open.
- [x] Run affected UI/queue/inbox tests.

## Task3: Verify, recover, release

**Files:** Add `e2e/bulk-task-completion.spec.ts`, extend rehearsal190, and `docs/ops/bulk-task-completion-recovery.md`. Owned synthetic drill under the ignored plan workspace.

- [x] Add6mocked browser scenarios covering desktop/mobile, read-only/deduplication, partial confirmation and exact check, stale-access queue stop, draft/filter/order/page retention and delayed responses. Preserve184existing scenarios and all guards.
- [x] Run existing real completion service through a mocked browser-style transport against disposable PostgreSQL. Verify exact activity/audit counts, duplicate/idempotent receipts, stale review/reassignment rejection, manager scope, foreign scope, partial result verification, and unchanged unrelated records. No production data.
- [x] Prove the exact code inverse/reapply. Reverting the UI leaves legitimate completed tasks and audit records; do not bulk reopen tasks or delete history. Verify baseline reads still show completions.
- [x] Run full `npm test`, `npm run lint`, `npm run test:receptionist:mocked`, guarded dummy `npm run build`, then `npx tsc --noEmit` and `npm run typecheck:fast` after builds.
- [ ] Get one fresh whole-change review; fix confirmed important issues test-first; merge/push and verify CI, exact deployment, anonymous denial, widget-off catalog and no private test writes.

This bounded queue makes partial outcomes explicit rather than providing batch atomicity. Cross-device persistence of an unfinished review, automatic retries, bulk reopening, provider behavior and production-scale throughput are outside this release.
