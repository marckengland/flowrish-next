# Core workflow audit

> Execute inline; obtain one fresh-context whole-branch review before merge.

**Goal:** Audit dashboard → leads → tasks → follow-up approval with synthetic data, fix demonstrated defects, and preserve permission boundaries and explicit approval.

**Approach:** Extend the existing isolated browser rehearsal with real client components and synthetic props. Keep production server/auth/database modules excluded. Test server-page permissions with mocked sessions and services. Use the existing query/filter/form patterns and styling; add no dependencies or schema.

**Constraints:** Widget stays off. No DeepSeek/provider, live auth/email, real CRM writes, or real test records. Existing tests retain assertions; ask before correcting a wrong test or fixture. Leave unrelated `.serena/` and `.spec-workflow/` untouched. The inherited session authorizes tested merge/push/deployment verification.

This audit covers the selected everyday paths and the defects reproduced below. It does not redesign the product or certify every CRM feature. Isolated client fixtures make live provider and production authorization behavior separate verification work.

## Steps

- [x] Inspect pages, hooks, permission filters and current rehearsal coverage; record demonstrated defects.
- [x] Add failing regressions for dashboard permission/data scope, lead-filter hydration and filtered-list loading. Fix root causes without changing existing API formats.
- [x] Exercise desktop/mobile dashboard navigation, lead search/create, task create/complete and follow-up approval, plus empty/error/read-only states, in the isolated browser suite.
- [x] Run formatter, focused tests, full tests, lint, guarded production build, strict/fast types, and the full isolated browser suite. Review independently and fix findings.
- [ ] Verify code rollback, merge/push the checked tree, verify CI/deployment read-only, preserve widget off and unchanged production records.

## Ledger

- Base `320115ec49dd3711f32e318e57b9f94b16f05ab8`; branch `codex/core-workflow-audit`.
- Initial findings to reproduce: dashboard missing the other pages' permission gate and unconditional create link; unfiltered SSR data reused while a new filter loads; stored search overwritten by mount-time effects. The dashboard's “This month” control has no handler.

- Reproduced and fixed: active session roles included another organization's administrator permissions; dashboard queried before a read gate, displayed unconditional New lead and unfiltered detail rows; lead table reused the default SSR page while filtering.
- Additional permission defect: layout created OWNER team memberships during GET when the current permission set was empty. Regression observed a `teamMember.create` with `roleId: owner`; removed automatic promotion. Legitimate membership repair now requires explicit administrator action.
- Browser creation/complete/approval journeys passed their workflow assertions but exposed a missing mailbox-health fixture (`GET /api/email/sync`). Approval requested to add a disconnected read-only response without changing assertions. Saved-filter browser regression independently reproduced search reset to empty.
- Fixture safety: only exact lead/task action import names are replaced with client-only fake adapters; relative production action paths, other server modules and credential clients stay forbidden. Seven safety probes pass.

- User approved both test corrections: literal existing storage key and disconnected read-only mailbox-health response. All original persistence, debounce, workflow, no-send/provider/extra-write assertions retained.
- Review found task API/action/detail checks trusted UI filtering. Added a trusted-session task facade; all exposed task entry points enforce member ownership, accessible-lead creation, and active-organization assignees. Scoped ownership remains in final update predicates. Member reassignment UI is hidden; manager access remains available.
- Proposed task execution also uses the facade and a scoped recent-lead fallback. The old raw task executor now refuses the action without database/provider calls; other action contracts are preserved.
- Existing lower-level task service callers retain default behavior for internal/property tests. All public routes/actions/detail pages use the facade; TasksPage already constructs its own fixed server filters. The original seven task property tests pass unchanged.
- Independent reviewer confirmed all fixes and found no remaining P1/P2 findings. Scope added server security fixes because the requested task workflow audit reproduced bypasses, not as an unrelated refactor.

- Full unit run: 1,918 passed, three existing researchAccount property tests timed out at 15,000ms. Root cause: real website DNS resolution before mocked provider fetch. Approval requested to mock the existing website extractor, retaining privacy/guardrail assertions. No timeout increase or skip.
- Browser run after approved fixtures: 37/38 passed; saved-search restoration is fixed. The 400ms artificial response delay can elapse before the loading assertion observes it. Approval requested for deterministic held-request fixture while preserving loading and absent-stale-row assertions.
- Added disposable PostgreSQL ownership/race tests. Initial setup failed with `Unknown argument organizationId` on Stage, which is scoped through Pipeline. Approval requested to correct only setup/cleanup; tests not verified yet.
- Production metadata check confirms current owner retains active-workspace read/write roles. Existing memberships 3, leads 10, waitlist 0, widget off. No role repair/backfill is attempted; this change prevents future automatic grants rather than rewriting existing memberships.
- User approved the website-extractor mock, Pipeline-scoped Stage fixture, and explicit browser request gate. All assertions remain. The focused AI property suite passes 12 tests; the disposable PostgreSQL suite passes five tests, including a real ownership change between read and update. Full unit suite passes 1,921 tests in 266 files.
- Guarded production build, strict TypeScript, fast TypeScript, and lint pass. Production manifests exclude synthetic routes and fake action adapters.
- Browser request gate now passes. Latest full rehearsal passes 37/38 scenarios; the desktop Deal Health assertion briefly matches links in both transitioning tabs. Approval requested to scope that assertion to its tabpanel and wait for destination pages before layout checks and screenshots.
- User approved the tabpanel selector and destination readiness waits. Final browser rehearsal passes all 38 scenarios and seven safety probes with no guard violations. Desktop and mobile screenshots show the intended pages without viewport overflow. All previous workflow and safety assertions remain. Lint and both type checks pass again after the final test edits.

## Limits and recovery

No dependency, schema, production data, provider key, widget, or email changes. Synthetic database rows exist only in an owned loopback PostgreSQL container. Live authentication and provider behavior remain untested by this mocked audit.

Existing organization-wide dashboard aggregates and manager task access retain their prior policy. This audit does not review every CRM feature or repair previously created memberships. Explicit administrator action is required if a real user lacks an appropriate role.

Code changes have no persistent side effects. A private, tested selective UI rollback preserves the permission fixes; reverting the whole release would restore confirmed authorization defects. For a permission regression, apply a reviewed forward fix instead of restoring automatic OWNER grants. No database restore, migration, or membership backfill is part of recovery.
