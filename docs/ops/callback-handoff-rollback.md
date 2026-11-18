# Callback handoff rollback

The migration adds only the private `CallbackCrmHandoff` receipt table and an organization relation. There is no backfill, widget activation, provider change, or existing CRM rewrite.

## Recover

If handoff confirmation fails or creates incorrect work, remove the application entry point through the normal deployment pipeline while retaining receipts:

```sh
git log --oneline --first-parent --grep='Merge callback CRM handoff'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103030000_add_callback_crm_handoff/migration.sql
git commit -m 'Disable callback CRM handoff'
```

Recovery takes one normal deployment. This removes the handoff API and UI; it preserves receipts and staff-approved CRM work. Existing website callbacks and the public widget continue to work. Retaining the additive table is compatible with the previous application and prevents duplicate handoff retries when the feature returns.

A code rollback cannot undo a staff-approved lead, contact link, task, or subsequent CRM edits. Review those records through the normal CRM screens. Do not drop the receipt table, remove an applied migration, bulk-delete CRM records, restore a full database snapshot, or force-push.

## Verification

Before deployment, record a read-only query confirming the receipt table is absent. Test the feature reverse in a temporary Git index: the application returns to the base tree, with only the additive Prisma schema/migration retained. Repeating that preservation is unchanged. Disposable database tests apply all migrations and verify private grants, atomic rollback of a failed task creation, concurrent confirmation, tenant checks, and permanent receipts after source/CRM deletion.

Production verification uses read-only requests and mocked browser mutations. It creates no real lead, task, link, receipt, callback, or widget setting and never reads/decrypts a saved AI key or calls a provider.
