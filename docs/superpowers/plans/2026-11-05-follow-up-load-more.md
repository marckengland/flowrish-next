# Follow-up Load more implementation plan

> Use superpowers:executing-plans inline, TDD and one fresh whole-branch review.

**Goal/spec:** Approved chat description/user request: append older matching follow-ups, preserving filters and unsent drafts, recheck workspace/user access, show loading/retry. No dependencies, widget activation, DeepSeek, real emails or production test writes.

**Architecture:** Standard keyset paging (createdAt DESC, id ASC),100 matches plus one lookahead. Opt-in list header keeps default legacy URL/array/call contracts unchanged; optional `after` cursor. Cursor carries validated date/id and a SHA256 fingerprint of server-derived org/user/status/normalized filters; this is a position, never an authorization grant. All queries independently enforce current access. Retained IDs never determine continuation; cursor anchor must be among authorized page rows returned. No schema/key/env changes.

**Client:** Optional `page.nextCursor` alongside existing array data/scope/capabilities. Existing no-page fixtures/clients behave as a single page. Track loaded page count. On Load more and visible revalidation, fetch contiguous pages from the start through the loaded count (plus one for Load more), deduplicate and merge once complete, preserving mounted card IDs/draft edits. Retain current open drafts/focused IDs in each page request. This costs more read-only requests for deep lists; large-list virtualization/saved cross-device paging are outside scope. Newly incoming rows may shift the current window; retained authorized drafts stay included. Filter/tab/refresh changes reset paging under existing draft confirmation; context change or revoked access clears all cached data. Abort/epoch fencing rejects stale reads, including drafts opened during loading. Transient errors retain current cards/cursor, no automatic retry until explicit action; privacy errors clear.

## Task1 server/protocol
- [x] RED: cursor/date/id/binding bounds, SQL keyset/lookahead and retained independence, cross-scope/filter misuse, malformed queries, unchanged default HTTP contracts.
- [x] GREEN: shared page metadata/input, server cursor helper, optional sixth list-page argument, SQL paged membership/count and authorized anchor.100 per page; final permission/task/lead checks retained. `followUpHttp`/client carry optional page metadata only when present.
- [x] Narrow tests, then synthetic PostgreSQL >200 rows, tied timestamps, filtered pages/no duplicates, removed anchor, cross-user/org/lead/task access, retained drafts independent of cursor/no extra workflow writes.

## Task2 client/browser
- [x] RED: page append preserves composer/filter; transient retry, overlap suppression, late response/filter/context changes, authorization removal and metadata validation. No generated/sent work.
- [x] GREEN: Load more, separate page loading/error state and cursor/count refs. Visible polls revalidate loaded contiguous pages without unmounting authorized cards. Default legacy mocks remain supported. New page header only on list reads, after param only on continuation.
- [x] Six approved guarded browser cases;124→130 retaining all124 and guards: desktop/mobile append, filters/due, unsent drafts, failed retry/rapid clicks, stale/access changes plus revalidation.

## Task3 finish
- [x] Full npm test/lint/build and postbuild strict/fast, full130 browser, isolated database drill and fresh whole-branch review. Substantive findings RED→GREEN in one fix pass.
- [ ] Code-only reverse patch proof, authorized merge/push, all CI jobs/exact-SHA deployment and read-only anonymous/private/widget checks. Archive own scratch; preserve managed checkout and unrelated files.

## Review focus

Stable ties/lookahead and no skipped or duplicated matching work; removed/inaccessible anchors cannot grant access or leak identifiers. Retained rows do not advance cursor. Filter/user/workspace mismatch rejects continuation. Older loaded work is freshly revalidated, not indefinitely cached. No draft loss on append/poll/errors; late reads and duplicate clicks cannot overwrite newer state. No automatic sends, approvals, generation, new dependencies or schema changes.

## Verification and boundary

Local verification passed:2,338 tests in359 files,130 guarded browser scenarios, lint, production build, and strict/fast type checks after the build. The isolated PostgreSQL17 drill loaded205 tied-timestamp records in100/100/5 pages and checked retained drafts, filters, removed anchors, access changes and no extra workflow writes. One fresh review found a retained-draft access race; reader and composer regressions failed before the fix and passed after it. All existing assertions and124 browser scenarios remain.

Paging covers existing follow-up suggestions. The existing100-callback materialization limit is unchanged; older callbacks not yet materialized are outside this feature. Deeper lists require more read-only revalidation requests. Live providers and email delivery were not tested. No dependencies, schema changes, widget activation or production test writes. Rollback is a normal revert of this code-only commit; no database undo is required.
