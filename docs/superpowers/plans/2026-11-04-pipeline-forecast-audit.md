# Pipeline and forecast audit

> Execute inline and obtain a fresh whole-change review before completion.

**Goal:** Verify stage moves, failed-save recovery, won/lost values, current forecast totals, workspace isolation, permissions, and mobile behavior using mocks.

**Approach:** Reuse the isolated browser rehearsal and real client components. Add regressions for demonstrated server defects, then make the smallest fixes. Use a database transaction and a conditional update for stage/closed-state/history consistency. Keep the board's server-confirmed save pattern, block overlapping moves, and reconcile with a read after failures. Separate currencies instead of inventing exchange rates.

**Constraints:** No provider calls, real records, email, widget changes, dependencies, schema, or production data mutations. Preserve unrelated `.serena/` and `.spec-workflow/`. Existing tests retain every assertion; ask before correcting a wrong fixture or expectation. No formatter is configured, so follow existing style and run the configured ESLint. Earlier session instructions authorize finishing, merging if needed, pushing main, and verifying CI/deployment; no authorization is inferred for production data writes.

USD is the existing displayed forecast/commit currency; stored submissions have no currency field. Make that reporting basis explicit and filter current money totals to USD. Keep other currencies visible separately on the board. Adding conversion or per-currency submissions later requires currency/version data and a migration. Historical unlabelled snapshot currency cannot be verified by this audit.

## Tasks

- [x] Reproduce stage authorization, foreign-stage lookup, non-atomic history, generic-edit closed state, duplicate move, and board loading/error defects. Implement scoped atomic stage updates and protect their public entry points. Cover source-state conflicts and no-op repeats.
- [x] Restrict board reads to its selected pipeline, keep truthful counts, remove the inert Filter control, and respect forecast-link permission. Block overlapping moves, update confirmed cache data, and reconcile uncertain failures without repeating writes.
- [x] Reproduce mixed-currency forecasts, invalid commit amounts, stale/other-user commit comparison, and page/action entitlement differences. Fix current reporting and validation without changing historical data or the heuristic's normal weighting formula.
- [x] Add desktop/mobile mocked browser journeys for moving, terminal outcomes, reopening, error recovery, amounts, current forecast, and read-only/denied access. Retain the existing 44 scenarios and safety guards.
- [x] Run focused tests, full unit suite, lint, guarded build, strict and fast type checks after build, and the full browser rehearsal. Obtain fresh review and fix demonstrated issues.

## Ledger

- Base `c2932e521237285b4898454bd5f9dd321729eb9a`; branch `codex/pipeline-forecast-audit`. Baseline passes 1,950 unit tests in 273 files.
- Target stages are not directly tenant-scoped in Prisma: their workspace is inherited through Pipeline. Existing target lookups omit that relation constraint.
- Existing generic stage edits update neither closed state nor transition history. Dedicated moves insert history before the lead update, without a transaction.
- Existing forecast values mix currencies while UI formatting and commits use USD. Existing comparison API selects the latest organization-wide submission regardless of user or current period.
- Existing APIs require a forecasting entitlement; the server page and form action do not. Keep the same authorization policy at each entry point.
- Scoped atomic updates and current USD reporting passed their focused regressions. Board reads now include the selected pipeline, and a requested assignee filter cannot replace the mandatory record-access filter.
- Initial expanded verification passed 1,973 unit tests and all 52 browser scenarios with eight safety probes and no guard violations.
- Ruling: include conversion and deletion in this audit because they are alternate paths to the same audited lead state. Fresh review demonstrated record-access bypasses on both and non-atomic conversion. Both APIs and actions now pass trusted scope; conversion locks and rechecks the scoped lead inside the transaction, reuses its linked contact, and commits lead/history/contact/cadence changes together. Regression fixtures model rollback without a database connection.
- Ruling: use UTC reporting months everywhere to match existing scheduled snapshots. Shared helper covers page, form, comparison API, dashboard, and scheduler. Boundary tests cover Asia/Manila and a negative UTC offset. This keeps reporting consistent but does not provide organization-local reporting months.
- Ruling: keep a confirmed forecast receipt even when cache refresh or UI follow-ups fail. Unknown persistence acknowledgements disable repeat submission until a reload. Rejected validation retains the editable draft.
- Review fixes reproduced six failing assertions plus the missing shared-period module before implementation. Their focused rerun passed 21 tests; API/action conversion and delete boundary tests passed two more. No existing test assertions or fixtures were changed.
- Fresh rereview found no remaining P1/P2 findings in scope and independently passed 25 tests across seven files. Actual PostgreSQL locking and rollback remain unverified under the mocks-only constraint.
- Final unit suite passed 1,984 tests in 283 files. ESLint and guarded production build passed. Post-build strict TypeScript and fast type checks passed.
- Final added mobile board-width assertion reproduced document overflow: `Expected: true; Received: false`, with 51/52 browser scenarios passing. Guarded loopback diagnosis measured 821px document width on a 390px viewport. Absolutely positioned screen-reader labels escaped the unpositioned scroller. Giving that scroller `position: relative` reduced document width to 390px while retaining the labels and horizontal column scrolling. Apply this one-class production fix and retain the failing assertion unchanged.
- After the overflow fix, the full suite again passed 1,984 tests in 283 files. All 52 mocked browser scenarios and eight safety probes passed with zero guard violations. ESLint, guarded production build, and both post-build type checks passed again. Mobile board/forecast screenshots were inspected.
- Ruling: retain the user's earlier session authorization to finish and merge if needed, push main, and verify deployment. The supplied Git rule requires a session instruction and does not revoke those instructions. Commit only this audit's files; preserve unrelated untracked directories. No dependencies, migrations, or stored production settings change.
- Rollback: revert this audit's feature commit and redeploy. No schema, seed, secret, widget setting, or production data migration needs an inverse. A code rollback does not reverse ordinary lead changes made by users after deployment. Verify the reverse patch before merging.

## Limits

This audit does not introduce FX conversion, change the forecast heuristic into a live AI model, repair historical leads/snapshots, redesign all lead CRUD, or certify every CRM feature. Org-wide forecast aggregates remain governed by `forecast:read`; pipeline lead details retain their existing record-access filter.
