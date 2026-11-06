# Accurate inbox tab counts

Use executing-plans inline with one fresh whole-change review.

Spec: read-only Pending, Approved, Dismissed and Snoozed totals across all accessible saved follow-ups, with an overdue-task indicator. Respect current user/workspace and each destination tab's relevant applied filters. Preserve draft/edit/uncertain-result/navigation fences. Finish, mock-test, fix and merge. No dependencies, DeepSeek, real emails or widget changes.

## Task 1: Read-only aggregate and contract

Write failing service/route tests. Extract existing eligibility SQL into a shared helper without altering list semantics. New counts service uses that helper, current membership/lead/task access, one DB time and conditional aggregates; no pagination limit, callback materialization or writes. Pending/Snoozed partition by private snooze time; projected filters match filtersForFollowUpTab. Overdue counts DISTINCT accessible open Approved task IDs matching Approved filters. Fresh permission recheck before return. Reject invalid, unsafe or malformed results. Add GET /api/follow-ups/counts with scoped identity, read permission, strict filter query and no-store response. Add optional inboxCounts capability to list responses/readers; old responses remain compatible.
Expected: narrow tests pass, old list assertions remain intact, aggregation issues no writes.

## Task 2: Client totals and retention

Write failing UI/hook tests. Opt in only with scope and advertised capability. Render badges with unchanged tab accessible names and descriptive count text, plus a compact overdue indicator. Fetch only committed applied filters; verify filter echo, identity, nonnegative safe integers, timestamp and stale request cancellation. Refresh after confirmed changes/list reads and existing notification events. Count reads never navigate, reset cards or mutate. Display loading/unavailable instead of zero on failed or stale reads; explicit read-only retry. Only genuine identity/read-access loss invokes the existing private-content clearing path.
Expected: exact draft nodes and uncertain controls survive count refreshes, events, ordinary failures and filter drafts; wrong-account responses clear safely.

## Task 3: Database and browser proof

Run an isolated synthetic PostgreSQL drill using copied schema/offline SQL only, loopback dummy URLs and owned disposable container. Verify >100 rows, duplicate task links, snooze boundary, filters, member/manager task scope, hidden/deleted/merged/wrong-owner/wrong-workspace rows, permission changes, counts/list equivalence and unchanged records. No production data or provider activity.
Add six guarded browser scenarios232→238; retain all existing scenarios/guards and only routine additive fixtures/contract assertions.
Expected: synthetic drill and238 browser cases pass, guard log empty, desktop/mobile screenshots inspected.

## Task 4: Verify and release

Full npm test, lint, build, mocked browser suite; strict and fast types after both builds. One fresh review; one test-first fix pass for Important findings. Prove staged inverse/reapply in temporary index. Commit, fast-forward main, push; verify all five CI jobs, exact release/alias, anonymous API denial including counts, and widget-off flag. Archive owned evidence and remove only this plan's scratch.
Expected: all checks observed passing, exact deployment ready, widget disabled.

## Interfaces and tradeoffs

Counts are facets: common search/source apply to all tabs; dueOnly applies only Pending and task progress only Approved, as navigation already does. Task order does not change totals. Approved total counts follow-up records, overdue indicator counts distinct tasks. Retained drafts outside filters and callbacks not yet materialized by catch-up are excluded. Aggregates share list eligibility SQL, reducing policy drift; the small extraction changes a list dependency and therefore requires existing list regression coverage plus synthetic equivalence. Capability gating preserves older payloads and mocked workflows. Accurate totals require an aggregate read; no estimates or cached cross-user counts. No schema/dependency changes, live-provider/email tests, production authenticated-write tests or manual screen-reader testing.

## Review focus

Check shared SQL parity and access predicates, private snoozes and callback eligibility, filters per tab, UTC boundary, duplicate tasks, no hidden-row leaks or write path, permission recheck races, count receipt/schema/identity/filter validation, canceled/late requests, refresh after all confirmed operations, labels/keyboard semantics, and unchanged drafts/uncertainty through count refreshes/errors. Inspect synthetic isolation and network guards.

Rollback: code-only revert; keep schema and saved records. Prove exact inverse/reapply before release; no database data rollback.
