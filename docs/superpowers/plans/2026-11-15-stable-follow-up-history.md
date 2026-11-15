# Stable follow-up history implementation

**Spec:** docs/superpowers/specs/2026-11-15-stable-follow-up-history-design.md
**Goal:** Stable Older/Newer paging under new actions while retaining filters, drafts, reviews and uncertain results.
**Method:** Inline implementation, TDD, one fresh final review.
**Constraints:** No dependencies, schema changes, production data writes, live AI, real email, or widget enabling. Preserve all assertions and unrelated files.

## Review Focus

- Strict (createdAt,id) keysets with upper boundary and scoped cursor validation; no offset in opted-in requests.
- Cursor bounds advance past malformed scanned rows and timestamp ties.
- Newer, focus and source-revision reads retain the right page; explicit refresh/filter/reopen reset it.
- Recoverable read failures and late/invalid receipts preserve drafts, reviews and request boundaries.
- Existing clients without the opt-in retain their strict response shape and authorization checks.

### Task 1: Stable history contract, service, panel and verification

**Files:** src/lib/follow-up-history.ts; new src/server/services/follow-up-history-cursor.ts; src/server/services/follow-up-history.ts; src/components/follow-ups/follow-up-history.tsx; src/app/api/follow-ups/[id]/history/route.ts; relevant existing tests; new e2e/stable-follow-up-history.spec.ts; existing history browser fixtures; scripts/inbox-performance.integration.test.ts; rehearsal config/runner.
**Interfaces:** New history-page header opts into optional data.paging={cursor,nextCursor}. Query cursor plus page/kind identifies an exact scoped position. Cursor codec stores v, scope binding, page, through and after anchors. Client stores request cursors by page, rejects missing or mismatched metadata and mixed entries, aborts prior requests, prunes later cursors after successful page reads.

- [ ] Add failing service, codec, route and panel tests for scoped keyset requests, legacy compatibility, source-revision/focus retention and retry/races.
- [ ] Run focused guarded tests. Expected: failures for missing stable paging behavior.
- [ ] Implement minimal opt-in contract, codec, before/after-scoped database query and panel cursor navigation; routine fixture updates preserve all assertions. Expected: focused tests pass.
- [ ] Add six guarded mocked browser scenarios and extend existing fixtures/total from 316 to 322 additively. Extend the disposable database drill for concurrent new rows/ties, forward/backward paging, malformed-row progress and unchanged work. Expected: narrow browser and database checks pass.
- [ ] Run full unit suite, full mocked browser rehearsal, main build, lint, then strict and fast types after both builds. Expected: all pass, no skipped/flaky tests or guard violations.
- [ ] Verify reverse patch and commit. Run one independent final review; fix material findings with RED/GREEN tests and full affected checks.
- [ ] Fast-forward main, recheck identical merged tree, push and verify all six CI jobs, exact deployed SHA/alias gate and anonymous privacy/widget checks. Expected: pass.

Explicit Refresh brings in newer actions. No arbitrary page jumps, date filters, persistent snapshots or migration changes.
