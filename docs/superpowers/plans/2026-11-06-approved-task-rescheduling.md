# Approved inbox task rescheduling implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Track each step below.

**Goal:** Review and confirm one linked task deadline change without leaving Approved or discarding filters and unsent drafts.

**Architecture:** Reuse the reviewed task lock, version, and access checks from completion. Resolve the chosen local minute with the existing IANA timezone resolver on the server, preview both deadlines, then commit a version-bound change with an exact request receipt. A separate card control retains edits and uncertain confirmations through filtered revalidation.

**Tech stack:** Existing Next.js, React, Zod, Prisma, PostgreSQL, Vitest, and Playwright.

**Spec:** The user approved the single-task rescheduling description in chat. Show a clear timezone, review the previous and new deadlines, record CRM activity, and preserve filters, drafts, and current access checks.

## Constraints

- No new dependencies or migrations. Widget stays off. No DeepSeek calls or real emails.
- Use mocked network responses and disposable synthetic PostgreSQL records for workflow verification. Production verification uses anonymous GETs and read-only aggregates.
- Preserve every existing test and assertion. Routine fixture, selector, type, and file-reference corrections may proceed under the user's updated instructions.
- Do not change callback appointment requests, callback outcomes, task assignees, task completion, or email approvals.
- Only incomplete Approved tasks can be rescheduled. Reject invalid, ambiguous, nonexistent, unchanged, or nonfuture deadlines.

## Review focus

- A changed task or source must invalidate an old deadline review.
- An uncertain response must keep its exact request check through focus refreshes and filtered pagination, with no automatic repeated POST.
- Completion and rescheduling must not race into a change to a completed task.
- Workspace, user, lead, or task-access changes must stop actions and redact private review content.
- Browser timezone detection must finish before review is enabled, and the server must independently resolve the local minute.

## Task 1: Server contracts and reviewed rescheduling

**Files:** Add `src/lib/follow-up-task-reschedule.ts`, `src/server/services/follow-up-task-review.ts`, `src/server/services/follow-up-task-reschedule.ts`, their service tests, and `src/app/api/follow-ups/[id]/task-reschedule/route.ts` with route tests. Reuse the extracted review helpers in the existing completion service without changing behavior.

**Interfaces:** Preview takes `{localTime,timeZone}` and returns current task details, old/new UTC deadlines, and a version. POST takes `{requestId,expectedVersion,taskId,localTime,timeZone}`. Receipt GET takes only the exact request ID and returns `confirmed`, `changed`, or `not-recorded`.

- [x] Add failing tests for timezone conversion, stale reviews, invalid/past/unchanged times, task scope, exact replay, current access, pause, and read-only verification.
- [x] Extract unchanged review helpers and implement the transaction. Update only the due date, standard lead activity time, one NOTE activity, and an audit receipt.
- [x] Run new service/HTTP tests and all existing completion tests. Expected: pass with every prior assertion retained.

## Task 2: Review UI and retained work

**Files:** Add `src/components/follow-ups/follow-up-task-reschedule.tsx` and tests. Integrate into `src/components/follow-ups/follow-up-inbox.tsx` with dedicated retained editor/pending state and a progress callback.

- [x] Write failing tests for explicit review/confirmation, timezone readiness, fixed reviewed values, cancellation, uncertain GET-only checks, exact receipts, privacy, and draft/filter preservation.
- [x] Implement the form in the detected browser timezone, then show old/new deadlines and current task/assignee details before confirmation. Deadline edits require a fresh review.
- [x] Retain editing and uncertain cards across background reads. Confirm navigation before discarding deadline edits or exact request checks. Prevent the same card's completion while its reschedule review is open, and prevent rescheduling while a completion result is unresolved.
- [x] Run the affected component tests. Expected: no repeated POST, silent filter changes, or remounted email composers.

## Task 3: Rehearse, review, and release

**Files:** Add six scenarios in `e2e/approved-task-reschedule.spec.ts`, extend rehearsal configuration/count from 166 to 172 while retaining all existing coverage, and add `docs/ops/approved-task-reschedule-recovery.md`.

- [x] Run a disposable PostgreSQL drill for concurrent same/distinct requests, completion versus rescheduling, failed activity/audit/final-permission rollback, unchanged out-of-scope data, and baseline reader compatibility.
- [x] Run `npm test`, `npm run lint`, `npm run test:receptionist:mocked`, and a guarded dummy-config `npm run build`. After both builds finish, run `npx tsc --noEmit` and `npm run typecheck:fast`.
- [x] Obtain one fresh whole-branch review. Fix confirmed Important/Critical issues in one regression-tested pass.
- [ ] Prove code rollback, merge/push the verified tree, and observe CI and exact deployment. Check anonymous denial, widget-off state, and unchanged migration count.

Bulk rescheduling and changing callback appointments remain outside this design.
