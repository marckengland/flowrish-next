# Activity history CSV export implementation

**Spec:** docs/superpowers/specs/2026-11-15-follow-up-history-export-design.md
**Goal:** Full filtered authorized CSV download, independent of paging and parent work.
**Method:** Inline TDD, one independent whole-branch review.
**Constraints:** No dependencies, migrations, production business-data changes, DeepSeek, real email or widget enabling; retain all assertions and unrelated files.

## Review Focus

- Export batches use the same safe projection/access checks and a separate purpose-bound cursor; no silent truncation.
- Every response/final check verifies identity, applied filters, range and exact position before downloading.
- Abort, timeout, scope/view changes and disconnected DOM prevent late downloads and extra reads.
- CSV contains only public action fields plus explicit metadata; formula/quote/newline escaping and empty-result handling stay valid.
- Displayed paging, draft date edits, mounted email drafts, active reviews and blocked retries remain intact.

### Task 1: Export contract, reader, collector, UI and verification

**Files:** new src/lib/follow-up-history-export.ts/tests, src/components/follow-ups/follow-up-history-export.tsx/tests and history/export route/tests; existing history service/cursor/panel and tests; new e2e/follow-up-history-export.spec.ts; disposable inbox integration; rehearsal config/runner; additive API-path lists if required.
**Interfaces:** Existing listFollowUpHistory gains default-false export mode. New batches exportVersion1/batchSize200/max200 entries use current filter/range/paging fields. Collector accepts captured id/context/kind/range/displayTimeZone/signal/isCurrent/onProgress, validates complete bounded reads and final snapshot check, then returns CSV/count/checkedAt. Child export component owns only export status/controller and native download.

- [ ] Write failing service/cursor, collector/CSV, route and component tests. Expected: missing export behavior fails with mocks only.
- [ ] Add the smallest export mode, thin read-only route, collector/CSV and fenced child control. Extend existing test fixtures only additively. Expected: focused checks pass.
- [ ] Add six guarded browser scenarios and raise required328 to334 while preserving all cases/guards. Add a synthetic PostgreSQL drill for multi-batch filtered export, cursor purpose, final access and unchanged work. Expected: narrow browser/DB checks pass.
- [ ] Run full unit suite, full mocked browser, main build, lint, then strict and fast types after both builds. Expected: all pass; zero skipped/flaky/guard violations.
- [ ] Prove reverse patch, commit, run one independent review and fix material findings with regression checks.
- [ ] Merge main, recheck identical tree, push and verify all six CI jobs, exact production SHA/alias gate, anonymous export denial and widget/catalog checks. Expected: pass.

Deferred: larger/background exports, persistent snapshots/resumption and arbitrary timezone selection. Incomplete reads never create a file; larger histories require narrower filters.
