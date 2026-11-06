# Approved inbox deadline sorting implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. Track the steps below.

**Goal:** Add earliest-deadline ordering to Approved and saved personal workspace views while retaining filters, pagination, and unsent drafts.

**Architecture:** Keep newest-first behavior as the default. Add opt-in `taskOrder: DUE_ASC`, task-order capability/header, and deadline-aware cursors. Apply the authorized order before LIMIT with unavailable deadlines last and deterministic created-time/ID ties. Bind sorted pages to a fingerprint of matching deadline keys and reject changed pages without clearing drafts. Changing only order revalidates the first page with retained editors and commits it without remounting cards.

**Stack:** Existing Next.js, React, Prisma, PostgreSQL, Zod, Vitest, and Playwright.

**Spec:** User approved deadline sorting, saved personal workspace ordering, preserved filters/pagination/drafts, current task permissions, mocked testing, and no task mutations.

## Constraints

- No dependencies or migrations. Keep the widget off. No DeepSeek calls or real emails.
- Use mocks and disposable PostgreSQL for workflow tests. Production verification uses anonymous GETs and read-only aggregates.
- Keep every existing assertion. Routine fixture, selector, type, and file-reference corrections are authorized.
- Earliest deadline means ascending UTC due date, then newest follow-up creation and ascending ID. Missing/inaccessible tasks sort last without exposing their dates.
- Sorting alone does not change task-progress/source/search filters. A new order starts at the first page and retains open drafts and deadline/completion reviews.
- Older clients hide order-specific saved views before strict decoding. Preserve their JSON records and legacy default cursor format.

## Review focus

- Equal deadlines, unavailable tasks, and pages beyond 100 must have stable, complete ordering.
- Deadline edits, new matching records, or changed task state between pages must reject stale continuation rather than omit work.
- A lost/failed/delayed sort read must preserve the prior applied order, current filters, and original composer nodes.
- Read-only users and stale workspace/account requests must retain existing access fences and private-date redaction.
- Saved-view rollback must hide unknown order fields before baseline strict parsing, without deleting or broadening a view.

## Task 1: Sorting contracts and server paging

**Files:** Add `src/lib/follow-up-task-order.ts`, `src/server/services/follow-up-deadline-page.ts`, and tests. Extend filter/saved-view schemas, page metadata/cursor, list endpoint/HTTP capability, and `follow-ups.ts` with opt-in sorting while keeping legacy paths unchanged.

- [x] Write failing tests for query/tab validation, deadline comparison, strict cursor binding, equal/null ties, changed-order rejection, permission scope, and no task writes.
- [x] Implement SQL ordering before LIMIT and a matching-key fingerprint. Recheck it after locked metadata reads. Add a sorted cursor version without changing default cursors.
- [x] Add opt-in saved-view reads that hide unsupported sorted views from older clients before strict parsing; keep user/workspace identity and quota checks.
- [x] Run affected server/contracts/HTTP tests. Expected: old assertions intact, valid sorted reads pass, stale sort pages reject safely.

## Task 2: Retained order changes and personal views

**Files:** Extend `follow-up-pages.ts`, `follow-up-inbox.tsx`, saved-view client headers, and focused tests.

- [x] Write failing reader/UI tests for globally sorted pages, order capability/version changes, draft-preserving order-only application, failure/retry, stale context, and cross-device saved order.
- [x] Add Newest/Earliest order selection in Approved with capability checks. Revalidate order-only changes without clearing keyed cards; retain editors, confirmations, and drafts outside the new first page.
- [x] Keep existing confirmation for changes to other filters/tabs. Clear incompatible order on leaving Approved and bind saved views to Approved.
- [x] Run affected UI/reader tests. Expected: unchanged search/source/progress, original composer nodes, explicit safe retry, no automatic writes.

## Task 3: Database/browser verification and release

**Files:** Add six scenarios in `e2e/approved-deadline-sort.spec.ts`, increase guarded rehearsal178->184 while retaining178 scenarios, and add `docs/ops/approved-deadline-sort-recovery.md` with a legacy saved-view compatibility patch.

- [x] Run disposable PostgreSQL verification for more than100 rows, equal deadlines, missing/foreign tasks, retained drafts, changed deadlines across/during pages, access changes, personal view isolation, and unchanged task/source records.
- [x] Prove baseline rollback reader compatibility with stored sorted views and an exact code inverse/reapply check.
- [x] Run `npm test`, `npm run lint`, `npm run test:receptionist:mocked`, and guarded dummy-config `npm run build`; then strict `npx tsc --noEmit` and `npm run typecheck:fast` after builds finish.
- [ ] Obtain one fresh whole-change review, fix confirmed Important/Critical issues with regressions, then merge/push and verify CI/exact deployment, anonymous denial, and widget-off state.

Fingerprint checks trade some read work for consistent pagination. Deadline edits can require a refresh; production-volume performance is not benchmarked in this scope. Task mutation, new priority controls, exports, and bulk actions are excluded.
