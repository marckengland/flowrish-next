# Restored follow-up activity implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Show Restored to Pending in the existing personal follow-up activity timeline without writes or private audit proof.

**Architecture:** Add restored to the public history kind/label and decode only the explicit valid restore audit shape from FollowUpSuggestion. Use AuditEntry.createdAt for occurredAt and retain existing read-only authorization, scanned pagination, lifecycle and current-state logic. No new endpoint/schema/dependency or provider call.

**Spec:** User approved a read-only restored action and time, scoped to the current user/workspace. Builder choice: require SHA256 inputHash/version, nullable bounded taskId and a valid restoredAt in the audit proof, but expose only existing safe event fields. Do not infer restoration from PENDING or a snooze reset. Valid records remain visible after later approval/dismissal.

## Constraints and review focus

- Widget off, no DeepSeek/real email, no new dependencies, no authenticated production business-data writes.
- Existing actor/workspace/assignee/lead/task authorization and final recheck stay intact, including read-only readers. No cross-user history or underlying audit changes/source/draft/proof fields returned.
- Audit timestamp determines action order/time. Restore produces one restored event, with no invented wake event or change to current status explanation.
- Require recognized entity type and complete valid restore proof. Skip malformed/unknown legacy records. Keep all existing kinds, scanned20/21 pagination and privacy assertions.
- Open-panel revision refresh keeps current drafts and uncertain results. New history reads never perform writes, replay restores, create tasks or call providers. Scope/access changes clear private history; late closed responses ignored.
- Add six mocked browser scenarios304→310, retaining every existing scenario/network guard. Strict types follow both Next builds. Disposable copied-schema database only; no prisma db push.

## Task 1: Safe restored event and timeline label

Files: src/lib/follow-up-history.ts; src/server/services/follow-up-history.ts/tests; src/components/follow-ups/follow-up-history.tsx/tests.
- [x] Add RED tests for valid restored proof, audit time instead of embedded time, no proof disclosure, read-only/personal scope, malformed proofs/wrong entity, pagination and subsequent current-state changes; UI label/time/refresh/no-mutation and identity/late response coverage.
- [x] Add restored kind/label and safe projection, update timeline description. Preserve all current assertions/behavior.
- [x] Focused tests GREEN.

## Task 2: Full-flow verification and release

Files: additive restore database drill in scripts/inbox-performance.integration.test.ts; new e2e/restored-follow-up-history.spec.ts; rehearsal config/count; plan.
- [x] Verify a real synthetic restore appears once with audit timestamp and safe fields, with unchanged existing DB assertions. Add six mocked browser scenarios for desktop/mobile label/timestamp, read-only paging, live restored revision with exact draft/blocked retry, failure retry and scope/late response clearing.
- [x] Full npm test/lint/build, then strict/fast types; test:receptionist:mocked and test:inbox:performance. Inspect desktop/mobile screenshots. Dummy env/socket/private-env guards only.
- [ ] One fresh whole-branch review, TDD fix confirmed issues; verify code rollback, commit/FF merge/push under session authorization, CI/exact deployed SHA/anonymous denial/private redirects/widget-off catalog. No production mutations.

What this makes harder later: shared team activity and richer restore details require a separate privacy contract. This change has no bulk restore, provider verification or new historical events inferred from incomplete legacy payloads.
