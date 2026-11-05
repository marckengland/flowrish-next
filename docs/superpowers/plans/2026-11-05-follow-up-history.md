# Follow-up activity history implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, TDD per task, one fresh whole-branch review at the end.

**Goal:** Show who approved, dismissed, snoozed or woke a follow-up, when the action occurred, and why an expired snooze has returned to Pending.

**Architecture:** A lazy read-only panel consumes a scoped history endpoint. Reuse existing audit records, follow-up authorization, private HTTP scope and database clock. No database migration, provider requests, background writes, dependencies, widget changes or email sends.

**Spec:** User-approved chat proposal: private per-workspace/user follow-up history, existing audit records, mock-only verification. Implementation calls: show only the current actor's actions as “You”; do not expose other users' personal snoozes. Explain elapsed time from the current snooze rather than fabricate a “returned” audit event. Team-wide history/export remain outside this change.

## Global constraints

- Preserve every existing assertion/scenario and network/write guard; ask before correcting tests.
- Keep the widget off. No DeepSeek or real email calls. Use Node22 and fake-only check environments.
- No dependencies or schema changes. Preserve unrelated worktree files.
- Full tests/lint/build and post-build strict/fast types; guarded browser run and fresh review before merge/push; exact-SHA CI/deployment and anonymous read-only verification afterward.

## Review focus

- No cross-user/workspace audit disclosure, raw JSON, email content or other entity histories.
- Reassignment, completed pending callbacks, lead merge/delete and access loss during a read must deny history.
- Unsupported legacy audit payloads must not invent actions; due explanations must reflect fresh database state, not client time.
- Closing/reopening, refreshing/paging and context changes must discard stale reads without discarding an unsent email draft.
- Opening/refreshing/polling history must never acknowledge, approve, generate, send or otherwise mutate work.

## Task 1: Scoped history service and HTTP

Files: src/lib/follow-up-history.ts, src/server/services/follow-up-history.ts, src/app/api/follow-ups/[id]/history/route.ts and new narrow tests.
Interface: listFollowUpHistory(org,user,id,{page?}) → {data:{id,entries,page,hasMore,current},canWrite}; GET uses followUpHttp and captured context. Entries contain only id/kind/actor/occurredAt/until/timeZone. Page20 plus one lookahead, deterministic createdAt/id order, max10000. Unknown UPDATE payloads omitted; pagination describes scanned audit pages.
- [ ] RED: sanitization, personal tenant scope, fresh authorization and assignee/task/lead checks, current due state, paging and malformed input.
- [ ] GREEN: authorized read transaction with member fence, check source before/after read and return capability; allow reviewed linked completed tasks only for current owner. Reuse database clock. No mutation or external I/O.
- [ ] Verify narrow service/HTTP suites; record evidence.

## Task 2: Lazy history panel and guarded browser scenarios

Files: src/components/follow-ups/follow-up-history.tsx and tests; integrate minimally into follow-up-inbox.tsx. Add e2e/follow-up-history.spec.ts and, with approval, count112→118 and config selection.
- [ ] RED: lazy open, safe rendering, retained drafts, delayed/stale/denied reads, empty/error/retry and paging.
- [ ] GREEN: View/Hide activity, ordered action/time list, current-state explanation, Refresh and paging; only GET with existing scope. Clear/abort on close, context/revision change and unmount. Revalidate open history on visible focus/minute; fresh privacy failures clear via parent. Accessible named region, stable labels and live status, mobile wrapping.
- [ ] Six browser cases: desktop/mobile history, due explanation plus no-write draft retention, pages/unsupported legacy rows, explicit transient retry, delayed close/stale/revoked access. Retain all112 original scenarios and guards.

## Task 3: Verify, review and release

- [ ] Full configured checks with mocks and no provider credentials. Disposable PostgreSQL read drill for actual audit filtering, source/access changes during waits, no writes, and fresh due explanations. No production test writes.
- [ ] Fresh whole-branch review, one RED→GREEN fix pass for confirmed substantive findings. Code-only rollback is to revert feature commit; existing audit data remains untouched.
- [ ] Merge/push authorized main, verify all CI and exact production SHA/domain, anonymous denial and widget-off catalog. Preserve managed checkout; archive/remove only owned scratch.
