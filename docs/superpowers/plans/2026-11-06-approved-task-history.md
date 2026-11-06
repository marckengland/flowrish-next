# Approved task activity history implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Track each step below.

**Goal:** Show a read-only timeline of recorded task rescheduling and completion inside Approved cards without discarding filters or unsent drafts.

**Architecture:** Read structured audit receipts for the currently authorized linked task across its recorded inbox actions. Reuse the lead/task/source locks with read permissions, select actor display names only, sanitize supported proof shapes, and page bounded results. A separate lazy card reader refreshes on task changes and focus, with scoped responses and aborts.

**Tech stack:** Existing Next.js, React, Zod, Prisma, PostgreSQL, Vitest, and Playwright.

**Spec:** User approved the in-chat description: who rescheduled or completed a task, old/new deadlines, timestamps and timezone labels, current access checks, and preservation of filters and unsent drafts.

## Constraints

- No new dependencies or migrations. Widget stays off. No DeepSeek or real email calls.
- Workflow verification uses mocked transport and disposable synthetic PostgreSQL only. Production checks use anonymous GETs and read-only configuration aggregates.
- Preserve all existing assertions. Routine fixture, selector, type, and file-reference corrections are authorized by the updated AGENTS instructions.
- Do not parse free-text notes, reconstruct unsupported CRM history, expose raw audit JSON, user emails, task hashes, or personal snoozes.
- Show audit recording times and stored UTC deadline values in the detected browser timezone, with an explicit UTC fallback. Do not invent an original timezone or completion timestamp.

## Review focus

- Task reassignment, relinking, deletion, or lost role/lead access must prevent private timeline disclosure.
- Another actor's recorded task action may appear only when the current linked task and workspace are authorized; only display names leave the server.
- Malformed, unrelated, and foreign receipts must be excluded without losing bounded pagination.
- Closing a reader, changing scope/task, or receiving late responses must not reopen or repopulate it.
- Viewing and refreshing history must not perform writes, trigger providers, remount email drafts, or silently change filters.

## Task 1: Scoped read service and HTTP route

**Files:** Add `src/lib/follow-up-task-history.ts`, `src/server/services/follow-up-task-history.ts`, their tests, and `src/app/api/follow-ups/[id]/task-history/route.ts` with route tests. Extend `src/server/services/follow-up-task-review.ts` with explicit read access while keeping write defaults unchanged.

**Interfaces:** `listTaskHistory(org,user,id,{page})` returns `{data:{id,taskId,page,hasMore,entries,checkedAt},canWrite}`. Entries contain ID, actor display label, recorded time, and either completion or rescheduling with previous/new UTC deadlines. GET accepts one bounded page only.

- [x] Write failing service/route tests for read-only access, actor/name privacy, supported receipt parsing, foreign/unrelated exclusion, pagination, final access loss, and zero writes.
- [x] Implement explicit read-mode task locks, narrow audit selection, strict output projection, and no-store scoped GET.
- [x] Run new service/route tests plus existing completion/rescheduling tests. Expected: every existing assertion remains intact and passes.

## Task 2: Lazy task timeline in Approved cards

**Files:** Add `src/components/follow-ups/follow-up-task-history.tsx` and tests. Integrate into `src/components/follow-ups/follow-up-inbox.tsx` with current task/progress revisions.

- [x] Write failing tests for lazy reads, timezone labels, old/new deadline rendering, pages, explicit retry, aborts/late responses, access loss, and preservation of the exact mounted composer.
- [x] Implement the read-only reader with open/close, refresh, bounded newer/older navigation, current-scope validation, and supported-history explanation.
- [x] Reset history when linked task/access changes. Refresh open history after confirmed completion/rescheduling without changing card keys or inbox filters.
- [x] Run affected component tests. Expected: only GET requests, no lost draft edits, no automatic mutation or retry after errors.

## Task 3: Verify, review, and release

**Files:** Add six scenarios in `e2e/approved-task-history.spec.ts`, extend the rehearsal from 172 to 178 with all existing scenarios retained, and add `docs/ops/approved-task-history-recovery.md`.

- [x] Run a disposable PostgreSQL drill using real completion/rescheduling receipts, another authorized actor, more than one page, malformed/foreign records, current task scope, and exact unchanged-record snapshots around history reads.
- [x] Run `npm test`, `npm run lint`, `npm run test:receptionist:mocked`, and a guarded dummy-config `npm run build`. After builds finish, run `npx tsc --noEmit` and `npm run typecheck:fast`.
- [x] Obtain one fresh whole-change review. Fix confirmed Critical/Important issues with regressions, preserving all assertions.
- [ ] Prove code rollback, merge/push the verified tree, observe CI/exact deployment, and verify anonymous denial and widget-off state.

This design makes complete legacy CRM history unavailable until those mutation paths record structured task IDs and event data. Bulk actions, exports, edits to history, and provider calls are outside scope.
