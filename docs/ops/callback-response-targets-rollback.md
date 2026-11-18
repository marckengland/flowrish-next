# Callback response targets rollback

Migration `20261103060000_add_callback_response_targets` creates two private tables and expands the existing notification-kind constraint. It backfills nothing and changes no business settings, provider credentials, widget activation, callback, or CRM record. Policies are disabled by default.

## Recover

If deadlines are wrong, escalation delivery fails, or the queue shows stale work, deploy the previous application code while retaining the additive schema and receipts:

```sh
git log --oneline --first-parent --grep='Merge callback response targets'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103060000_add_callback_response_targets/migration.sql
git commit -m 'Disable callback response targets'
```

Recovery takes one normal deployment. Resync `/api/inngest` using its standard registration PUT so Inngest removes the response-target cron. Ordinary callback notifications and approved CRM workflows continue using their existing behavior. Reinstalling the feature preserves policy versions and notification read/deduplication state.

Retain the expanded constraint because existing escalation rows can depend on it. Do not drop tables, delete receipts, remove or edit an applied migration, restore a full database snapshot, or force-push. A rollback cannot undo an alert someone already saw. It does not call a visitor or modify CRM outcomes.

## Verify the rollback

Before release, use a temporary Git index to reverse the staged feature patch and compare its tree to the exact baseline. Retaining only `prisma/schema.prisma` and the new migration must produce the intended rollback tree. Restoring those files twice must leave that tree unchanged. Existing migration files and unrelated files must match the baseline.

Disposable PostgreSQL tests cover additive migration constraints, RLS and revoked browser-role privileges, retry deduplication, live permissions and policy/source changes, retained CRM obligations, and unchanged ordinary notification keys. Browser mutations use mocks. Production verification reads metadata and counts only; never invoke a production sweep as a test, create test business data, activate a widget, or retrieve/decrypt/use the saved DeepSeek key.
