# Do not contact implementation plan

Use executing-plans inline, then one fresh whole-branch reviewer. Spec: docs/superpowers/specs/2026-11-05-do-not-contact.md. Existing Node22/Prisma/React stack; no dependencies. Baseline354b073.

1. TDD normalized workspace suppression lookup, archived/duplicate inheritance, scoped versioned review and permission/rollback cases. Add private schema/migration, shared policy and transactional preference service. Verify narrow tests RED→GREEN, synthetic DDL/RLS/constraints/rollback and exclusion across organizations.
2. TDD manual/background send and cadence wake/refresh races. Wire shared send guard and all Microsoft delivery stages; enrollment/bulk/resume serialization; stop blocked durable jobs. Retain old fixtures/assertions after approval. Verify narrow transport/cadence tests with no live network.
3. Add lead-detail scoped controls with explicit reason/review, private cache handling, stale/uncertain response behavior, keyboard/mobile checks. Extend mocked browser scenarios while retaining100 and guards after approval. Verify UI tests and browser rehearsal.
4. Full tests/lint/build then strict/fast types; synthetic PostgreSQL duplicate/merge/enrollment/write-wait proof; tested fail-closed recovery; fresh review and one regression fix pass. Merge/push and verify exact CI/deployment/catalog/anonymous API/widget state read-only. Preserve protected worktree and unrelated files; archive own evidence.

Review focus: suppression surviving lead mutations; database errors must never allow sends; alternate/archived explicit recipient bypasses; queued job caching and retry behavior; block/enroll/clear races and lock ordering; stale actor/lead snapshot writes; audit rollback; no resurrection after explicit clear; privacy of inaccessible duplicates.
