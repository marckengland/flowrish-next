# Approved inbox task completion implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement each task in this session. Steps use checkbox syntax.

**Goal:** Complete one linked CRM task from the Approved inbox after reviewing and confirming its current details.

**Architecture:** A scoped endpoint previews the current task, accepts a versioned confirmation, and reads an exact request receipt. One transaction locks the lead, task, and follow-up, checks current access, and writes task completion, the standard CRM activity, lead activity time, and an audit receipt. A separate card control preserves the mounted email composer and current filters.

**Tech Stack:** Existing Next.js, React, Zod, Prisma, PostgreSQL, Vitest, and Playwright.

**Spec:** User-approved scope in chat: review and confirmation for one linked task; preserve filters and unsent drafts; no bulk completion.

## Global constraints

- No new dependencies or migrations.
- Keep the widget off. Do not use DeepSeek or send real emails.
- Verification uses mocked network responses and disposable synthetic PostgreSQL data only.
- Preserve all existing tests and assertions. The user approved extending the browser rehearsal from 160 to 166 scenarios.
- Use current workspace, user, lead, and task permissions. Never accept identity from a request body.
- Complete the task only. Do not infer a callback outcome, dismiss the follow-up, or change email approval.

## Review focus

- A changed task or linked source after preview must reject confirmation before writing.
- Lost responses must offer a read-only result check, never an automatic repeated mutation.
- Permission loss and workspace switching must remove private review data and stop pending actions.
- Concurrent confirmations must create one completion activity, including two different request IDs.
- Completion under Open or Overdue filters must not discard an unsent draft or silently broaden the filter.

## Task 1: Add reviewed completion service and endpoint

**Files:** Create `src/lib/follow-up-task-completion.ts`, `src/server/services/follow-up-task-completion.ts`, their tests, and `src/app/api/follow-ups/[id]/task-completion/route.ts` with route tests.

**Interfaces:** `previewTaskCompletion(org, user, id)` returns a strict preview with task details and version. `completeFollowUpTask(org, user, id, input)` accepts `{requestId, expectedVersion, taskId}`. `readTaskCompletion(org, user, id, requestId)` returns `confirmed`, `changed`, or `not-recorded` with exact scope and request identity.

- [x] Write and run failing tests for preview privacy, unchanged records on reads, transactional completion, exact replay, stale task/source, task ownership, final access, pause, and rejected identity input.
- [x] Implement the smallest service using the existing follow-up access helpers, lock order, audit table, and HTTP wrapper.
- [x] Run service and route tests. Expected: all pass with no provider imports or email calls.

## Task 2: Add review and confirmation controls

**Files:** Create `src/components/follow-ups/follow-up-task-completion.tsx` and tests. Modify `src/components/follow-ups/follow-up-inbox.tsx` to pass scope, task progress, busy coordination, and a completed-progress callback.

**Interfaces:** The control receives an Approved task ID and current progress, reviews via GET, confirms once via POST, and checks uncertain results via GET with the same request ID. Its parent updates visible task progress without remounting cards.

- [x] Write and run failing component tests for review/cancel/confirm, draft preservation, exact receipt validation, lost response checks, read-only controls, stale task and stale account responses.
- [x] Implement accessible named review controls and explicit confirmation. Keep the reviewed details fixed. Block navigation while a request is in flight.
- [x] Run the affected component tests. Expected: drafts, filters, and existing actions remain intact.

## Task 3: Rehearse, review, and release

**Files:** Add `e2e/approved-task-completion.spec.ts`. Extend the approved browser configuration and required count to 166. Add recovery instructions in `docs/ops/approved-task-completion-recovery.md`.

- [x] Add six guarded browser scenarios covering desktop/mobile confirmation, lost response, stale task, read-only access, and stale account responses.
- [x] Run a disposable PostgreSQL drill for concurrent confirmations, rollback on failed activity/audit/final access, unchanged out-of-scope records, exact replay, and baseline compatibility.
- [x] Run `npm test`, `npm run lint`, `npm run test:receptionist:mocked`, and `npm run build`. Then run `npx tsc --noEmit` and `npm run typecheck:fast`.
- [x] Review the whole diff independently. Fix confirmed issues with red-to-green regression coverage.
- [ ] Prove code rollback, merge and push if all checks pass, then verify CI and exact production deployment with anonymous GETs only.

This design makes bulk completion harder later because each task has its own review and confirmation receipt. No bulk endpoint is included.
