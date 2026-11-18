# Bulk lead updates: release and rollback

## Migration compatibility

Migration `20261105010000_add_bulk_lead_updates` adds a private table and membership relation. Table creation, checks, RLS, and browser-role privilege revocation run in one transaction, including when default privileges otherwise grant access to browser roles. Existing business rows are unchanged by this migration.

## Verification

Node 22 verification covers strict input validation, session identity fences, current access, owner scope and identity changes, immutable versions, expiry, no-op rows, transactional audit, count-only replay, explicit confirmation, lost responses, and filter/view selection boundaries. The mocked browser suite retains its original 70 scenarios and adds six bulk scenarios, with external-network and unexpected-write guards.

An owned, network-isolated PostgreSQL 17 container applied all 36 migrations with invented organizations, members, leads, and audit entries. Checks proved:

- Injected DDL failure leaves no partial table; browser roles cannot read the completed table under permissive default grants.
- Membership, receipt-state, hash, and snapshot checks reject invalid rows; membership deletion removes its private previews.
- An audit foreign-key failure rolls back the lead changes and leaves the receipt unapplied.
- Conditional status undo restores the eligible row, preserves a later-edited row and another organization’s row, and writes exactly one repair audit. Running it again changes nothing.
- Conditional owner undo restores a current member, is idempotent, and skips a departed former owner.

## Remove the feature code

Signals: repeated bulk-update errors, incorrect preview rendering, or inability to retrieve a confirmed receipt. Stop new bulk operations while investigating. Prepare a selective application rollback from your current release, retaining the additive Prisma schema, applied migration, previews, receipts, audit records, and existing saved-view behavior. Disable new bulk operations while preserving receipt inspection for uncertain results. Test the recovery branch in a disposable checkout with the full checks before explicit approval and deployment. No private maintainer recovery branch is distributed with this repository.

Do not drop the table, edit the applied migration, force-push main, or restore an entire database snapshot to remove this feature. Code rollback does not reverse completed lead updates. Expect a normal CI/deployment cycle; deployment timing must be observed rather than assumed.

## Repair one confirmed batch

The separate [operator SQL](../../scripts/recovery/undo-bulk-lead-update.sql) is a data-changing repair and requires explicit approval for the exact business, batch, and acting user. It is never part of deployment or application startup. Inspect the original audit entries and current lead versions first. Use `psql --no-psqlrc -v ON_ERROR_STOP=1`, provide `organization_id`, `batch_id`, and `actor_id`, then run that file through an approved database connection. Keep connection credentials out of shell history and logs.

The SQL locks affected rows and memberships, restores only the reviewed field when both current value and timestamp still match the original batch, skips deleted/later-edited leads and departed former owners, and records each restoration transactionally. A second run is a no-op because restored versions change. The batch receipt remains a historical record of the original operation. Skipped leads require individual review; do not remove the version predicates to force restoration. No tasks, messages, stages, or unrelated rows are repaired by this procedure.

Synthetic drills do not verify an off-site backup or production restore. Maintain a separate recovery policy for your installation.
