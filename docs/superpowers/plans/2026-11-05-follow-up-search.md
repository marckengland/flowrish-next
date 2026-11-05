# Follow-up search and filters implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, TDD and one fresh whole-branch review.

**Goal:** Search accessible follow-ups by lead name/email/title beyond the recent100; filter Email/Callback and due reminders.
**Spec:** Approved chat proposal and user request. Existing stack, no dependencies, keep widget off, no DeepSeek or real email. Use mocked providers/browser and isolated synthetic PostgreSQL. No production test writes.
**Architecture:** Add bounded optional filters to existing scoped list service/GET without changing default signatures or payload. Apply text/source/due predicates before LIMIT100, independently retain authorized focused/open-draft rows. Use literal case-insensitive substring matching with SQL parameters, not wildcard semantics. Reuse current permissions, task/current owner checks and server timestamp. No schema/index changes.
**UI:** Explicit Apply/Clear form with active-filter summary. Existing navigation confirmation protects open drafts. Search/source persist across tabs; applying due-only moves to Pending and leaving Pending clears due-only. Context-keyed root resets all private fields when workspace/user changes; no local storage or URL persistence. Focused/open draft rows may appear outside filters with an explanatory note. Read-only users can search; filters never generate, approve or send.
**Tradeoff:** Explicit Apply requires a click/Enter after editing. Cross-device filter persistence and fuzzy/full-text ranking are outside this change.

## Task1: Server filtering
- [ ] RED new shared-schema/query-building and service/GET tests: bounded defaults, invalid source/due, literal percent/underscore/quote input, parameterized predicates before page limit, retained IDs independent of filters and unchanged default API calls.
- [ ] GREEN add src/lib/follow-up-filters.ts and src/server/services/follow-up-filter-sql.ts; optional fifth filters argument to listFollowUps. Only known filter query keys extracted; unknown legacy workspace query parameters remain ignored and cannot select a tenant.
- [ ] Verify narrow suites. No existing test assertions modified without approval.

## Task2: Form and guarded browsing
- [ ] RED tests for explicit apply, source/due status rules, draft discard/cancel, clear, stale responses/context changes and no provider/write effects.
- [ ] GREEN minimally extend FollowUpInbox navigation/form/query construction; query filters included in both full loads and retained-draft polls. Preserve default request URL and all existing behavior/coverage.
- [ ] With approval add6 browser cases and count118→124 retaining all118 and guards. Desktop/mobile, old-item search, sources/due, draft confirmation, pending/error/empty/clear, stale/context/read-only.

## Task3: Verify/review/release
- [ ] Full tests/lint/build, postbuild strict/fast and guarded browser. Synthetic database >100 rows proves old matches before limit, literal matching/source/due/retention/access isolation and no extra writes.
- [ ] One fresh whole-branch review; substantive fixes RED→GREEN. Code-only rollback preserves all existing data; verify reverse patch before merging.
- [ ] Merge/push authorized main, all CI jobs and exact-SHA deployment plus anonymous search-API/privacy/widget-off read-only checks. Preserve unrelated files and protected managed checkout; archive/remove only owned scratch.

## Review focus

Filters apply to all accessible matching records before truncation, not only100recent; no injection or wildcard broadening. Authorization and assignee/task/DNC approval safeguards unchanged. Due uses DB time and pending status/own snooze. Retained drafts/focused rows remain authorized exceptions. Applying/clearing/tab/filter changes handle open drafts honestly and prevent late reads from replacing newer results. Workspace/user switches clear search fields and private responses. No filter/read action sends, generates or acknowledges work.
