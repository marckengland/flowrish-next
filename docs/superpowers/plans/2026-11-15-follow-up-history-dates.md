# Activity history date ranges implementation

**Spec:** docs/superpowers/specs/2026-11-15-follow-up-history-dates-design.md
**Goal:** Full-history date filters preserving stable paging and parent work.
**Method:** Inline implementation, TDD, one independent final review.
**Constraints:** No dependencies, schema changes, production data writes, live AI, real emails or widget enabling. Preserve all assertions and unrelated files.

## Review Focus

- Inclusive local dates become [start,end) UTC bounds using existing validation; no 24-hour DST assumption.
- The date window is applied before pagination and bound to cursor identity and exact client receipts.
- Draft controls remain separate from applied dates; automatic reads and retries keep dates frozen.
- Relative preset rollover is explicit, does not discard edits, and rejects late previous-window results.
- Old clients keep their response shapes and access checks; invalid input makes no private read or mutation.

### Task 1: Date contract, service, panel and verification

**Files:** new src/lib/follow-up-history-dates.ts and tests; existing history lib/codec/service/panel/route and tests; history browser fixtures; new e2e/follow-up-history-dates.spec.ts; scripts/inbox-performance.integration.test.ts; rehearsal config/runner.
**Interfaces:** Resolve {from,to,timeZone} into {from,to,timeZone,start,end}. Presets return fixed calendar windows. New history-dates:1 header requires history-page:1; query includes optional complete date triple; data.range optional for legacy compatibility and mandatory for new client. Cursor scope adds optional canonical range.

- [ ] Write failing date/codec/service/panel tests for boundaries, full-history query, receipt validation, applied-vs-draft state, paging/retry/races and preset rollover. Expected: guarded focused run fails for missing date functionality.
- [ ] Implement minimal shared helper, opt-in contract and query bounds, date-aware cursor binding, draft/apply UI, receipt validation and relative-refresh behavior. Extend routine fixtures without removing assertions. Expected: focused checks pass.
- [ ] Add six guarded browser scenarios and extend fixture/required total322 to328 additively. Add disposable PostgreSQL cases beyond a first page, exact local boundaries, ties, cursor isolation and unchanged work. Expected: targeted browser and DB drill pass.
- [ ] Run full unit suite, full mocked browser rehearsal, main build, lint, then strict and fast types after both builds. Expected: all green with zero skipped/flaky cases and guard violations.
- [ ] Prove reverse patch, commit, run one fresh whole-branch review; fix material findings with regression tests and required full checks.
- [ ] Merge main, verify identical merged tree, push and verify all six CI jobs and exact production SHA/alias gate plus anonymous privacy/widget checks. Expected: pass.

Later work: ambiguous/skipped midnight support, arbitrary timezone selection and persisted range preferences. Date/action filters reset history navigation; parent work is retained.
