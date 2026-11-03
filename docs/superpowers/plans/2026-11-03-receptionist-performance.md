# Receptionist performance dashboard

User approved the proposed dashboard through “go”. Implement inline using existing Next.js, Prisma/PostgreSQL, Zod, and shared UI components. Existing session authorization covers finishing, fixing, merging, and deployment. Never retrieve/decrypt/use the saved AI key, call AI/Twilio, invoke a production sweep, enable a widget, or create production test records. Preserve `.serena/` and `.spec-workflow/`.

## Design decisions

Use the standard request-date cohort reporting pattern. Show independent milestone bars for available requests, approved CRM handoffs, recorded contact, and closure. Closure does not imply contact or a sale, so do not draw a misleading narrowing funnel. Counts and row drilldowns share SQL predicates and a repeatable-read snapshot.

Date inputs are inclusive UTC dates, defaulting to the latest 30 days including today, with at most 366 dates per report. Reject duplicate/unknown parameters, impossible dates, invalid owners, and excessive pages. Owner means current CRM owner, not owner when an event happened. Unassigned means no CRM handoff. A removed member's name must not leak from a global User relation. Selectable owners are current organization members, bounded to 200.

Managers need fresh organization membership and Settings plus CRM read/write permissions, including the existing local-team role union. The page and GET API enforce this; requests cannot select an organization. Queries and DTOs expose identifiers, safe current member names, dates, counts, and reported result categories, never visitor details, task titles, staff notes, transcripts, credentials, or organization settings.

Requests are selected by confirmation date; subsequent handoffs and outcomes are observed as of report time. First contact means the earliest Reached or No answer after approved handoff. Retry, manual task completion, and closure alone do not invent contact. Latest result is counted once per handed-off request, independent of ever-contacted/closed milestones. Timing uses median elapsed minutes, includes closed business hours, excludes invalid/missing timestamps, and displays sample counts.

Deleting a request removes it from its original cohort because its creation time is not retained. Report retained handoffs separately by handoff date, with a separate drilldown and missed-contact count. Missing/inactive CRM destinations preserve historical milestones but have no task link. Waiting and missed work use current eligibility; missed flags reuse the current enabled policy/version and source predicates. A paused or changed policy hides stale flags. Reads do not calculate targets, reconcile notifications, or change data.

Layout matches Flowrish's existing neutral dashboard, typography, green accent, and responsive controls. Add `/callbacks/performance`, links in receptionist Settings and response targets, labelled native date/owner controls, an explicit Apply filters action, accessible milestone buttons, operational totals/timing/result summaries, and 20-row record drilldowns. Loading/error/empty/permission states must be clear. Abort/unmount/query identity checks prevent stale reports replacing newer filters; policy-change events clear stale metrics. No new dependencies, schema, migration, cache, or scheduled function.

This approach makes historical owner attribution and deleted-request cohort reconstruction harder later; both require retained audit fields instead of inferred values.

## Tasks

1. Add failing contract/date tests in `src/lib/callback-performance.test.ts`; implement strict query/response contracts, UTC defaults, and formatting helpers in `src/lib/callback-performance.ts`. Verify date boundaries/leap days/range limits and malformed DTO rejection.
2. Add failing synthetic PostgreSQL tests in `scripts/callback-performance.integration.test.ts` with its own Vitest config. Implement `src/server/services/callback-performance.ts` with read-only snapshot queries and fresh access checks. Cover cohort deduplication, independent milestones, contact semantics, medians/sample counts, current owner/date filters, retained work, deleted/inactive destinations, cross-organization roles/data, stale policy flags, pagination, and unchanged business/AI data.
3. Add failing HTTP tests, then GET `/api/callback-performance` with no-store success/errors, session scope, strict bounded queries, fresh authorization, and safe static error messages.
4. Add failing UI tests, then client dashboard/page and navigation links. Cover filtering/drilldowns, sample/zero/unknown values, stale/aborted responses, unavailable CRM links, malformed payloads, and error recovery. New browser tests mock all writes, forbid providers, exercise desktop/mobile/dark layouts, and verify read-only production access separately.
5. Run independent whole-branch review, full unit/lint/strict and fast type/Prisma/build checks, new real disposable PostgreSQL suite and relevant existing callback database/browser regressions. No edits to existing tests or dependency changes without approval. Document definitions, limits, and rollback. Antidote is a normal code revert because this feature writes nothing and changes no persistent schema/config.
6. Commit/merge into main, verify merged tests, push under existing authorization, observe CI/deployment, and run production browser checks using mocked writes/read-only GETs. Confirm unchanged production counts and no enabled policy/widget/test data. No scheduler registration change is required.

## Review focus

- No false contact/success claims from closure, Retry, completion, duplicate outcomes, deleted sources, or missing targets.
- Cohort denominators, retained data, elapsed-time samples, date/owner filters, and drilldowns must agree.
- Current local organization roles and memberships must gate every response; foreign/global names and sensitive source fields must stay out.
- Current policy/source eligibility must hide obsolete missed flags without a write or expensive reconciliation on GET.
- Invalid/duplicate queries, race conditions, stale data, empty pages, and mobile controls must not mislead or leak previous reports.

## Execution record

Baseline `28ef742c1ab7d2579842a6e8ac62f44b05bb5534`. Existing suite: 1,543 tests. No production mutation authorized for verification.

Implemented Tasks 1–4 with new tests and no changes to existing test files. Contract, HTTP, PostgreSQL, and client tests first failed because their new modules were absent, then passed with implementation. Client checks caught duplicate unavailable-destination text and owner-name markup; both were fixed without weakening assertions. The new Playwright select locator was corrected to use its accessible role/name, retaining the value assertion. Screenshot inspection caught dark native date controls; the shared local control style now sets dark color-scheme, verified in mobile screenshots.

Verified 1,554 unit tests in 193 files; 10 new real disposable PostgreSQL tests; existing response-target (20), outcome (14), and notification (22) PostgreSQL tests. Strict/fast TypeScript, lint with fixes, Prisma validation, and guarded production build passed. Ten authenticated desktop/mobile browser checks passed, including new read-only smoke, dashboard filters/drilldowns/error recovery, existing response-target controls, guided setup, and receptionist settings. Browser writes are mocked; API/SQL smoke reads only. Screenshots cover desktop/light and mobile/dark headers, controls, and record drilldowns. Provider guard recorded zero attempted transports.

Read-only production baseline was zero callbacks, handoffs, outcomes, notifications, policies, targets, and enabled widgets. No schema, dependencies, provider settings, persistent configuration, or scheduler changes were introduced. Rollback is a code revert; exact-tree rollback proof and release checks follow before push.

Final independent review: ready to merge; no Critical or Important findings. Reviewer independently passed the 11 focused contract/API/UI tests and checked SQL/privacy/current role boundaries. Final: minor (deferred): the page-shell predicate uses the existing session permission union, so a user with permissions only in another organization can briefly mount the dashboard before its fresh local API check rejects access. No report data is disclosed; the effect is unnecessary loading before the permission message.

Final: Ruling: production-scale latency was not benchmarked against representative customer data. Ship with the 366-date bound, paginated records, explicit reads, and 15-second transaction timeout; make no latency/capacity promise. Cost if wrong: large organizations may get a slow report or a retryable unavailable response. The review also excluded final deployed behavior, which the root release verification will cover with production browser checks and read-only counts.

Temporary-index rollback proof passed: reversing the full staged feature patch restored the exact baseline application/schema tree. Restoring that baseline again left its tree unchanged. No persistent rollback operations are needed.

## Organization-permission follow-up

The user approved fixing the deferred page-shell mismatch. The page now reuses the API's current-organization `callbackAccess` check before mounting the report. It catches only membership-denial `AppError` 403; authentication and database failures propagate. Unrelated pages and the global session permission helper remain unchanged.

Seven new page tests exercise the real access helper and report client with mocked session/database transport. Six failed against the previous page; all seven pass with the fix. Coverage includes foreign-only roles, complementary permissions split between organizations, fresh local grants, removed membership, authentication, and database failures. A new-test assertion was corrected to inspect the SQL tag's interpolated argument, preserving its organization/user binding checks. Existing test files and assertions were untouched.

Verified 1,561 unit tests, the 10 existing disposable performance database tests, strict/fast TypeScript, lint, Prisma validation, guarded production build, and four authenticated browser checks with mocked writes/read-only API access. Provider guard recorded zero transports. Independent review found no issues and separately passed the seven page tests. The original deferred page-shell finding is resolved. Rollback is a normal revert of this follow-up merge; no persistent schema/configuration changed.
