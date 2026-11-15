# Restore dismissed follow-ups implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Recover accidental dismissal through current review and explicit confirmation, preserving task links, drafts and send protections.

**Architecture:** Add a scoped restore endpoint with read-only preview and exact-request receipt reads, plus a versioned confirm using the existing audit table for idempotency. Reuse canonical member→lead→task→follow-up locks, approvalSnapshot fingerprints and fresh permission checks. Add a small Dismissed-card control that retains reviews and uncertain results through filtering, preserves the card until explicit refresh and never grants send/retry permission. No schema/dependencies.

**Spec:** User approved Restore to Pending with review/confirmation, no duplicate tasks, retained task links/drafts/blocked retries, mocks only, widget off/no DeepSeek/real emails. Builder choice: reject completed/reassigned/missing linked tasks; clear prior personal snooze so restored work is visible in Pending. Existing task and source/draft/send records remain unchanged. Standard optimistic concurrency and idempotency-key receipts protect reviewed writes. Persisted audit proof uses the existing AuditEntry primary key, not a new table.

## Constraints and review focus

- Require current workspace/user scope, leads read/write, current follow-up ownership and visible unmerged lead for preview/confirm/recovery. Refresh after stale version; no replay after unconfirmed POST.
- Confirm strictly DISMISSED→PENDING; keep taskId and draft/source fields. Never create/update a Task or send attempt, schedule mail, call AI/providers or enable widget. CALL needs an owned open task; EMAIL may have no task.
- Current version includes row/task/snooze. Lock order matches approval/snooze/routing; audit/snooze/status updates atomic. Exact confirmed input replay writes once; changed input/status/task/source/permissions rejected. Audit failure rolls back.
- Client validates scope, canWrite, preview/receipt IDs, request UUID and linked task ID. Retain unknown request until explicit GET receipt; no repeated POST from clicks/reconnect/refresh. Stop/ignore late reads on unmount/scope/access loss. No automatic requests on mount.
- Retain drafts, selected filters, active review and unknown results. Keep restored card visible with a Pending label; list refresh remains explicit. Respect paused writes and existing DNC/send recovery protections.
- Keep all existing assertions/scenarios and network guards. Add six browser scenarios298→304. All full checks; strict types after both Next builds. Disposable PostgreSQL only, copied schema/offline SQL; never prisma db push.

## Task 1: Reviewed restore contract, transaction and HTTP

Files: new src/lib/follow-up-restore.ts; src/server/services/follow-up-restore.ts and tests; src/app/api/follow-ups/[id]/restore/route.ts and tests.
- [x] RED tests for preview/no writes; EMAIL/CALL restore and unchanged links/content/tasks; snooze clearing; exact replay/receipt read; stale task/source/snooze/status; permission/workspace/owner loss; malformed input/pause; safe errors/rollback.
- [x] Implement strict preview/input/receipt schemas, locked snapshots, version/CAS update, scoped audit proof and no-write receipt reads. Reuse approvalSnapshot for version and task eligibility.
- [x] Run focused service/route tests GREEN. No migrations.

## Task 2: Dismissed-card review, confirmation and recovery

Files: new src/components/follow-ups/follow-up-restore.tsx/tests; existing follow-up-inbox.tsx; new inbox integration test.
- [x] RED tests for review/cancel, confirmation task/draft retention, no-mount reads, stale previews/receipts, lost POST exact GET recovery/no-repeat, offline/context/permission loss, mounted drafts and guarded navigation.
- [x] Implement a Restore to Pending region using existing scoped client requests; one captured UUID/input before POST. Retain work with card/editor tracking; block navigation during requests and guard unresolved work. Retain task link and local draft; notify counts only after verified receipt.
- [x] Run focused UI/inbox tests GREEN, keeping all existing checks.

## Task 3: Synthetic drill, browser and release

Files: additive scripts/inbox-performance.integration.test.ts restore drill; e2e/restore-dismissed-follow-ups.spec.ts; rehearsal config/count; plan.
- [x] Add disposable DB checks for concurrent exact replay/one audit, unchanged task/draft/send records, snooze reset, Pending visibility, stale task/access, and audit-failure rollback. Existing performance checks stay intact.
- [x] Add six mocked desktop/mobile review-confirm, lost receipt/no-repeat, stale version/actor, read-only access and filtered exact draft preservation scenarios; retain298 originals and guards.
- [x] Run focused tests, full npm test/lint/build, strict and fast types after builds, test:receptionist:mocked and test:inbox:performance. Inspect desktop/mobile screenshots.
- [ ] One fresh whole-branch review; TDD fix confirmed issues. Verify code rollback, commit/FF merge/push under existing authorization, CI and exact live SHA/access/widget-off checks. No production business-data changes.

What this makes harder later: restoring completed-task work and shared/team reassignment need separate reviewed workflows. There is no bulk restore, automatic restore or live provider verification.
