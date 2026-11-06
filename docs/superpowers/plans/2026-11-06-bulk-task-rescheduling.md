# Bulk Approved deadline rescheduling implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, test-first, with one final fresh whole-change review.

**Goal:** Move up to20 unique open Approved tasks to one chosen local deadline/timezone after an exact per-task review and explicit confirmation, keeping inbox state and safe partial results.

**Architecture:** Reuse the existing task-reschedule GET preview, POST confirmation, exact-request GET receipt, timezone converter and audited transaction. Add a bounded client queue and a separate selection/review component. Reuse open-task eligibility/list keys from bulk completion without changing its behavior. Preserve selection/target/review while loading pages or changing only order; guard other navigation and competing mutations.

**Tech Stack:** Existing React, Next.js, Zod, Intl, Vitest, Playwright, Prisma/PostgreSQL. No packages, migrations or server API changes.

**Spec:** Approved in-chat description: select open/overdue tasks, choose deadline and timezone, review each old/new deadline, explicitly confirm; individual results, stop on error, preserve filters/order/pages/drafts. Mocks only, widget off, no DeepSeek or real emails.

## Global constraints

- Maximum20 loaded unique task IDs. Completed, unavailable, unapproved and duplicate task occurrences cannot enter the batch.
- One common local minute and IANA timezone per batch, defaulting to the browser zone but explicitly editable. Reject invalid/past/ambiguous/nonexistent times and unchanged deadlines before confirmation; the server remains authoritative.
- Frozen plan stores exact task/request IDs, review version, target local minute/timezone, old UTC deadline and new UTC deadline. Validate matching preview metadata and every receipt's old/new dates.
- Preview/check use scoped GET. Explicit confirmation sends sequential POSTs. Stop on first failure or stale context. Never automatically repeat/continue a write; check only failed/unconfirmed attempted requests.
- Preserve original keyed composers, filters, saved order, pages, selections and review/target input on safe reads. Dirty target/review/results hold navigation; sorting alone retains state. Competing task completion/rescheduling and bulk mutations stay blocked until the hold is cleared.
- No new dependencies, real provider calls, production test writes, emails or widget activation. Keep every existing assertion and190browser scenarios; add6for196.

## Review focus

- Invalid or ambiguous timezone conversion, poisoned target metadata, and mismatched old/new receipt dates must stop before further writes.
- An unchanged deadline or task edited/completed/reassigned after review must not be overwritten from stale input.
- Duplicate task occurrences and lost/aborted receipts must not create duplicate activities/audits or submit the remaining queue.
- Delayed/stale-account/read-only responses must stop work and redact private review details.
- Target edits, selection changes, sort/page reads, and completion/reschedule hold interactions must preserve drafts and prevent conflicting operations.

## Task1: Bounded timezone-aware queue

**Files:** Create `src/lib/follow-up-bulk-task-reschedule.ts` and test. Consume unchanged completion eligibility/list-key helpers and existing reschedule schemas/converter.
**Interfaces:** `makeBulkTaskReschedulePlan(raw)`, `previewBulkTaskReschedule(ids,target,context,hooks)`, `runBulkTaskReschedule(plan,context,hooks)`, `verifyBulkTaskReschedule(plan,previous,context,hooks)`,20limit and selection aliases.

- [x] Write/run failing tests for unique bounds, target validation/DST/no-op, exact preview/old-new receipt checks, sequential frozen writes, partial/uncertain outcomes, GET-only checks, permission/context/current-selection/abort guards.
- [x] Implement the minimal queue with25second request timeout and immutable captured account/inputs. Future checks belong to new reviews/writes; checking an older request remains possible after its deadline passes.
- [x] Run narrow queue and existing reschedule tests.

## Task2: Approved target/review UI and retention

**Files:** Create `src/components/follow-ups/follow-up-bulk-task-reschedule.tsx`, modify inbox, add focused UI tests.
**Interfaces:** Separate selected IDs and `BulkRescheduleHold = editing|review|results|false` with retained IDs, busy and existing receipt/access callbacks.

- [x] Write/run failing tests for selection/target/review/confirm, actual assignees, timezone labels, deduplication, invalid input, changing target invalidation, partial check-only results, stale context, private redaction and delayed navigation.
- [x] Implement accessible common deadline/timezone fields, per-task old/new review, confirmation, per-item results and exact request checking. Edits invalidate old review. Clear explicitly releases selection/input/results holds.
- [x] Retain target/reviews and original drafts during order-only changes and page refresh; guard other navigation and competing completion/rescheduling/bulk actions without changing existing empty-state behavior.
- [x] Run affected UI/inbox tests with all existing assertions.

## Task3: Verify, recover and release

**Files:** Add6mocked scenarios in `e2e/bulk-task-reschedule.spec.ts`, extend rehearsal190->196, add `docs/ops/bulk-task-rescheduling-recovery.md`, owned synthetic drill in ignored plan workspace.

- [x] Run6browser scenarios for desktop/mobile, duplicate/read-only selection, timezone validation and changed review, lost receipt GET-only check, held stale-account queue stop, draft/filter/order/page retention. Keep190existing scenarios and every guard.
- [x] Drill the existing real service via mocked transport in disposable PG17: exact old/new dates, audit/activity counts, duplicate/concurrent idempotency, stale task/target, completed/reassigned/foreign denial, manager scope, partial/check-only behavior, baseline reader compatibility, unchanged unrelated sources/outcomes/tasks, no providers/emails/widgets.
- [x] Prove exact code inverse/reapply. Reverting controls preserves legitimate task deadlines and audit history. Never automatically restore old dates or restore the whole database.
- [x] Run full tests, lint, guarded dummy build and mocked rehearsal; after builds run strict tsc and fast typecheck.
- [ ] Obtain one final fresh whole-change review, fix confirmed important issues test-first, merge/push and verify all CI jobs, exact production alias/SHA, anonymous denial and widget-off catalog.

Partial outcomes remain committed; the queue is not atomic. Per-task custom targets, business callback calendar changes, durable cross-device unfinished reviews, automatic retries/rollback, live providers and production-scale throughput are excluded.
