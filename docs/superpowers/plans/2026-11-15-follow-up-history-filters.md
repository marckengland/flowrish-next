# Follow-up activity filters implementation

**Spec:** docs/superpowers/specs/2026-11-15-follow-up-history-filters-design.md
**Goal:** Filter personal activity across its full saved history while preserving drafts and reviews.
**Method:** Inline execution as requested; one whole-branch independent review.
**Constraints:** No dependencies, schema changes, live providers, real emails, widget enablement, or production data changes. Preserve every existing assertion and unrelated file.

## Review Focus

- JSON discriminator selection must precede offset pagination and remain scoped to user/workspace/follow-up.
- Restore precedence and malformed payload validation must not leak a different action or raw proof.
- Filter, page, identity and source changes must reject late receipts while retaining parent draft/review nodes.
- Filtered empty pages and read failures must leave a usable explicit retry and navigation.
- Old All receipts remain compatible, but filtered receipts must identify the exact selected kind.

### Task 1: Full-history filtering and verification

**Files:** src/lib/follow-up-history.ts; src/server/services/follow-up-history.ts; src/components/follow-ups/follow-up-history.tsx; their existing tests; history route tests; new e2e/follow-up-history-filters.spec.ts; scripts/inbox-performance.integration.test.ts; playwright.rehearsal.config.ts; scripts/run-receptionist-rehearsal.mjs.
**Interfaces:** Query kind defaults to all with five action values. Data receipt adds defaulted kind for compatibility. Service applies kind discriminator before existing skip/take and safe projection. Client captures kind per request and verifies it.

- [ ] Write failing service and UI tests for kinds, receipt validation, pagination, filter changes/retry/revision, and late reads. Add read-only route forwarding coverage.
- [ ] Run guarded focused tests. Expected: fail because kind is unsupported and selector absent.
- [ ] Add the minimal query/receipt/service/select implementation, retain all existing All behavior. Run focused tests. Expected: all pass.
- [ ] Add six fully guarded browser scenarios and extend rehearsal total 310 to 316 additively. Add a real disposable-database test with older matching events behind more than one page of other actions, all five kinds, privacy, scope, and unchanged work. Expected: targeted and synthetic checks pass.
- [ ] Run full mocked unit/browser checks, lint, both production builds, then strict and fast type checks. Expected: no failing/skipped/flaky tests or guard violations.
- [ ] Commit intended changes, run one fresh whole-branch review and one TDD fix pass for material findings. Prove reverse patch rollback.
- [ ] Fast-forward main, push under standing authorization, verify all six CI jobs and exact production SHA/alias gate plus anonymous read-only safety. Expected: pass; widget count remains zero.

New action types require a query and decoder update later; no arbitrary date/search filters, persisted filter preferences, snapshot pagination, or new audit storage are in scope.
