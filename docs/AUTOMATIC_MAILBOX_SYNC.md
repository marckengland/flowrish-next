# Automatic mailbox sync

Connected Gmail and Microsoft 365 mailboxes are checked every five minutes using the existing Inngest background service. Sync finds matching sales replies and feeds the follow-up inbox. This polling interval means replies can take up to one interval plus processing time to appear; it is not a provider push subscription.

The **Mailbox sync** panel in Follow-up inbox and Settings shows the last successful sync, queued/running/failed state, and a manual **Sync now** action for each mailbox. The panel refreshes every 30 seconds while visible. Suggestion cards retain their separate Refresh action so automatic status updates cannot discard task edits.

Automatic monitoring requires valid production Inngest event/signing keys and a synced Inngest app at the deployed `/api/inngest` endpoint. Placeholder credentials are reported as unavailable. The configuration indicator means keys are configured; verify function registration and run history in Inngest when operating the service. See the [Inngest deployment guide](https://www.inngest.com/docs/platform-and-operations/apps-and-syncs).

## Behavior and recovery

Each mailbox has a queue lease and stable run identity. Concurrent manual and scheduled requests queue one event. Each executed page renews its running lease without moving the frozen checkpoint. A stale queued/running lease can be reclaimed after 15 minutes; completion/failure from the old run cannot overwrite the newer one. Workers check current membership and lead permissions before accessing a mailbox.

Gmail and Graph pages are processed in durable steps. New records and their timeline entries are committed together, and persisted metadata is replayed for reply detection after a retry. Subsequent runs start from the previous successful run's start time with overlap; the first run covers the previous day. The checkpoint advances only after all pages and reconciliation complete. Deleted Gmail messages (404) are skipped; other failures retry and ultimately show a safe error. Each request has a timeout. A 100-page safety limit fails visibly without advancing the checkpoint.

Health endpoints return safe status metadata for the current organization/user, never provider tokens or raw provider responses. Sync never sends mail. Review email drafts separately and use the composer's Send action explicitly.

## Verification and rollback

The base commit is `3da118d`. The migration adds health columns to EmailAccount and changes no existing mailbox credentials. Revert the feature merge and redeploy the previous application; retain the additive columns, message history and checkpoints. Resync the previous Inngest function list so the new cron is removed. Previously queued sync events use the old on-demand worker after rollback. Never restore the whole database, edit an applied migration, or delete mailbox/message records to undo this feature.

Rollback does not undo cadence exits or tasks users approved. Before rollout, record counts and checkpoints without mailbox addresses or tokens. Test code reversal on a disposable archive and migration/concurrency behavior on disposable PostgreSQL.

Before/after migration verification on 2026-11-02: 2 organizations, 10 leads, 7 tasks, 9 activities, 1 mailbox, 0 email messages; counts unchanged. The mailbox's health begins idle. No credentials were changed. Disposable PostgreSQL verified concurrent queue deduplication, failure/checkpoint retention, stale-run guards, auth boundaries, and permission/membership checks.

Verification commands: `npm test`, `npm run lint`, `npm run typecheck:fast`, `npm run build`, and `node_modules/.bin/vitest run --config vitest.mailbox-sync.config.ts`. The existing follow-up and receptionist PostgreSQL suites also remain applicable.

Rollback reverse-patch verification passed on a disposable archive: every tracked file hash returned to the base commit. Final local checks: 1,046 unit tests, 20 PostgreSQL integration tests, lint, both typecheck engines, and production build passed. Browser suite: 26 passed with 4 existing navigation guards skipped; all new sync health cases passed.
