# Inbox freshness and offline recovery

The Follow-up inbox shows a separate list-freshness region with its last successful check time. The timestamp changes only after a validated response is applied to the current list. Inbox counts keep their own refresh and unavailable states; a list check does not confirm a pending mutation.

Use **Check again** to reread the loaded page window with the applied filters. It retains mounted draft composers, unsaved card/filter edits, selected work, active reviews, and uncertain results. Unapplied filters stay unapplied. If a checked row is now dismissed, its open unsent draft remains mounted with sending disabled; an uncertain dismissal receipt stays unconfirmed. The control is disabled during list loading, active card requests, bulk operations, and an offline connection. It sends list GET requests through the existing page reader and never retries an approval, task update, draft generation, or email send.

Before its first successful read, an offline inbox is labelled not checked instead of empty. A disconnect cancels the active list read and keeps the last loaded cards and check time. A late response cannot mark that list fresh. Reconnecting offers an explicit check and does not replay actions. Browser connection status is a hint; only a successful API response verifies the list. Failed reads preserve local work and the previous timestamp. Focus and periodic refresh do not repeatedly retry a failed or interrupted read; use Check again or the relevant existing retry control.

Fresh membership/account checks still take precedence over retaining edits. Verified access loss clears private cards, composers, results, and freshness metadata. The existing Refresh button keeps its discard-confirmation behavior.

## Verification and limits

Unit and guarded browser scenarios cover initial offline/error states, reconnects, keyboard/mobile layout, retained drafts and filter edits, uncertain approval, multi-page checks, interrupted/obsolete reads, and stale-account denial. Browser routes use synthetic fixtures; unknown API calls, provider traffic, and unexpected writes are rejected. All existing rehearsal scenarios remain required.

This does not store drafts across a page reload, provide cross-device draft editing, queue offline actions, or prove API availability from an online event. There are no dependency, API, schema, or widget-configuration changes. Rollback is a normal code revert; no data recovery is needed.
