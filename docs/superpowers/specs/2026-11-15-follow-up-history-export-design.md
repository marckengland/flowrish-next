# Filtered activity-history CSV export

Add Export activity CSV within the personal history panel. Export uses the applied action/date filters, shown timezone and a fresh separate keyset walk from the newest matching page. It does not change displayed paging, unsubmitted date edits, email drafts, task reviews, or blocked retries. No automatic export/read on mount. Show confirmed record/batch progress, Cancel export, and explicit error/restart. Say download started, never claim the file was saved by the OS.

## Read contract

New GET history/export returns scoped JSON export batches using the existing history reader and all before/after access checks. Each batch scans at most200 rows plus a lookahead, projects only the existing safe action fields, and echoes id/kind/range/paging plus exportVersion1 and batchSize200. Export cursors bind a separate purpose so ordinary history cursors cannot skip the beginning or change batch interpretation. Legacy history response shapes/20-row pages/tokens stay unchanged. Query duplicates, invalid values, wrong identities, and wrong date/purpose/page cursors fail safely.

The client walks at most100 batches (20,000 scanned records), rejects repeated tokens/IDs, backwards chronological responses, wrong filters/range/position, out-of-window records, missing metadata and unsupported receipts. Malformed audit rows may produce empty batches but advance the raw boundary. If the complete result exceeds the bound, show a narrow-filters error and produce no file. No truncation. Bounded memory and a30-second read timeout prevent runaway work.

After all batches and CSV formatting succeed, re-read the first snapshot page using its cursor to recheck current permissions/ownership and unchanged first-page entries/continuation. Then allow a download only if the captured identity/view still matches and the exporter DOM is connected. Scope/view changes, cancellation, unmount, failed reads and timeouts discard collected data and never download. No automatic retry or stored/resumable export buffer. Historical inserts below cursor bounds are not a persistent database snapshot.

## File

UTF-8 CSV with BOM, CRLF, quoted/escaped cells and spreadsheet-formula escaping. Fixed safe filename. Columns include row type, action ID, action label, actor, recorded UTC timestamp, recorded local timestamp with milliseconds, display timezone, snooze-until UTC and saved timezone, applied action filter, inclusive from/to and filter timezone, exclusive UTC bounds, first-read time, final access-check time and action count. A distinct Export details row carries filters and counts even for zero results; Action rows contain only authorized recorded actions. No lead names/emails, org/user IDs, task links, source/draft text, proof/hash or cursor contents.

## Approach and limits

Reuse the history service with a purpose-bound200-row export mode and a thin read-only route, plus a cancellable client collector and native Blob download. Reading20-row UI pages is unnecessarily chatty; a single unbounded query or background job adds resource/retention risk. A future larger export service would require different storage/job handling. This release adds no dependency, migration, provider request, email, business-data write, or widget activation.

Verify full filtered history, stable separate paging, access checks at every batch/final read, safe CSV/timezones/formulas, zero-result metadata, cancellation/timeouts/limits/invalid or stale receipts, and exact mounted draft/review/blocked-send retention. Use mocks and disposable PostgreSQL only, one fresh final review, all project checks, then authorized merge/push and exact CI/deployment/privacy/widget verification.
