# Activity history date ranges

Add All dates, Last 7 days, Last 30 days and Custom range to each personal activity panel. Dates are inclusive calendar dates in the displayed browser timezone. Custom fields stay local until Apply date range; invalid or incomplete input makes no request. Applied date/action filters remain independent of parent drafts, task reviews and blocked retries. Date edits survive focus/source refresh and failed reads. Show the applied dates and timezone. Action timestamps use the applied timezone.

Reuse resolveLocalMinute for local midnight boundaries. Represent database ranges as UTC [start, end), with end at the following local calendar date, including 23/25-hour days. Reject impossible/reversed dates, invalid zones and ambiguous/missing midnight boundaries clearly. Supporting those rare boundaries later needs additional calendar logic; no timezone library is added. Selected dates are bounded to years 2000–2100; no duration cap is needed because reads remain limited to 21 scoped rows.

## Contract and paging

A new history-dates opt-in header requires stable history paging. Without it, legacy and stable-v1 responses remain unchanged. Queries carry from/to/timeZone only when a range is applied. Opted-in receipts echo range:null for All, or canonical from/to/timeZone/start/end. Client checks this exact receipt, page, kind, positions and scope before displaying anything. Missing or mismatched metadata is recoverable and must not revoke valid drafts.

Apply range before pagination and safe audit projection. Bind the complete canonical date window to the cursor scope while preserving the old binding for no range. Date/action changes reset page positions; Older/Newer, Retry, focus and source revision keep the applied window. Relative presets freeze when applied. Explicit Refresh/reopening updates relative presets to the current local date and starts a new history view; draft date edits stay untouched. Late results after range/context changes are ignored. Authorization before/after reads remains unchanged, and current-state metadata is independent of historical filters.

## Approach and limits

Use existing timezone validation, native date inputs and the existing versioned cursor convention. Client-only filtering would miss older pages; rolling 24-hour offsets would not describe calendar dates through clock changes. No migrations, dependencies or persistent snapshots. Historical inserts below cursor bounds may still appear. Arbitrary timezone selection, persistent date preferences and support for ambiguous/skipped midnight boundaries are outside this release.

Verify Manila local-day edges, New York 23/25-hour days, fractional offsets, leap dates, inclusive end, preset rollover, cursor/range mismatches, full-history filtering, malformed pages, races and exact mounted draft/review retention. Use mocks and the disposable PostgreSQL drill; no production data changes, widget activation, DeepSeek or real emails. Run all project checks, one independent final review, then merge/push under standing authorization and verify CI and deployment read-only.
