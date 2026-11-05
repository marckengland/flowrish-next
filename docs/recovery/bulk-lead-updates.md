# Bulk lead updates: release and rollback

## Recorded baseline

On 2026-11-05, production served `1f382a75022758886e816c5623314ca4c18bc26f`, Vercel deployment `dpl_98FWCM1mcC7JR9PgZb4kdbgYyDYY`, project `prj_AFfVtIp4EO7TqUmIzBYDzDPI8zeb`. A read-only database query confirmed 35 finished migrations, no `BulkLeadUpdate` table, and zero enabled website receptionist widgets. No business records or credentials were retrieved.

Migration `20261105010000_add_bulk_lead_updates` adds a private table and membership relation. Table creation, checks, RLS, and browser-role privilege revocation run in one transaction, including when default privileges otherwise grant access to browser roles. Existing business rows are unchanged by this migration.

## Verification

Node 22 verification covers strict input validation, session identity fences, current access, owner scope and identity changes, immutable versions, expiry, no-op rows, transactional audit, count-only replay, explicit confirmation, lost responses, and filter/view selection boundaries. The mocked browser suite retains its original 70 scenarios and adds six bulk scenarios, with external-network and unexpected-write guards.

An owned, network-isolated PostgreSQL 17 container applied all 36 migrations with invented organizations, members, leads, and audit entries. Checks proved:

- Injected DDL failure leaves no partial table; browser roles cannot read the completed table under permissive default grants.
- Membership, receipt-state, hash, and snapshot checks reject invalid rows; membership deletion removes its private previews.
- An audit foreign-key failure rolls back the lead changes and leaves the receipt unapplied.
- Conditional status undo restores the eligible row, preserves a later-edited row and another organization’s row, and writes exactly one repair audit. Running it again changes nothing.
- Conditional owner undo restores a current member, is idempotent, and skips a departed former owner.

The container and temporary schema/configuration were removed. No production data-repair command was run. Local checks passed: 2,116 tests across 310 files, ESLint, production build, strict and fast TypeScript checks, and all 76 mocked browser scenarios with no guard violations. Independent review found no remaining material issues. Production verification uses read-only catalog queries and anonymous GET requests.

## Remove the feature code

Signals: repeated bulk-update errors, incorrect preview rendering, or inability to retrieve a confirmed receipt. Stop new bulk operations while investigating. The local `antidote/bulk-lead-updates` branch contains the prepared code inverse. After explicit approval, cherry-pick its tip onto current main and run the repository checks before pushing. The inverse retains the additive Prisma schema, applied migration, existing previews/receipts, and audit records. It removes the bulk controls, APIs, and browser scenarios while retaining the original saved-view behavior and 70-scenario rehearsal. The prepared inverse restored the baseline code exactly and passed all 2,093 baseline tests and the fast TypeScript check in an isolated checkout.

Do not drop the table, edit the applied migration, force-push main, or restore an entire database snapshot to remove this feature. Code rollback does not reverse completed lead updates. Expect a normal CI/deployment cycle; deployment timing must be observed rather than assumed.

## Repair one confirmed batch

The separate [operator SQL](../../scripts/recovery/undo-bulk-lead-update.sql) is a data-changing repair and requires explicit approval for the exact business, batch, and acting user. It is never part of deployment or application startup. Inspect the original audit entries and current lead versions first. Use `psql --no-psqlrc -v ON_ERROR_STOP=1`, provide `organization_id`, `batch_id`, and `actor_id`, then run that file through an approved database connection. Keep connection credentials out of shell history and logs.

The SQL locks affected rows and memberships, restores only the reviewed field when both current value and timestamp still match the original batch, skips deleted/later-edited leads and departed former owners, and records each restoration transactionally. A second run is a no-op because restored versions change. The batch receipt remains a historical record of the original operation. Skipped leads require individual review; do not remove the version predicates to force restoration. No tasks, messages, stages, or unrelated rows are repaired by this procedure.

This synthetic drill does not verify an off-site backup or production restore. Backup destination and scheduling remain deferred at the user’s request.
