# Callback notifications rollback

The baseline before release was `3a1f127e04de1b339cb786db92467007f7411127`. A read-only production query on 2026-11-03 found no `CallbackNotification` table, zero website callbacks, zero callback handoffs and zero enabled widgets. The migration creates only the private notification table, its constraints/index and foreign keys; it backfills nothing and changes no existing callback, CRM record, provider setting or widget activation.

## Recover

If notifications fail, duplicate, or show stale work, remove the feature through the normal deployment pipeline while preserving delivery/read receipts:

```sh
git log --oneline --first-parent --grep='Merge callback notifications'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103050000_add_callback_notifications/migration.sql
git commit -m 'Disable callback notifications'
```

Recovery takes one deployment. Resync the previous function list at `/api/inngest` so Inngest removes the notification cron. This removes the bell/inbox and the scheduled function while retaining the additive private schema. Existing visitor callback submission, CRM handoff, task management and outcome tracking continue unchanged. Do not drop the table, remove an applied migration, restore a database snapshot, or force-push.

A rollback cannot make a user forget an alert they saw. Retain read/deduplication state so reinstating the code cannot redeliver the same task version as new. Notifications store identifiers and timestamps, with no visitor names, phone numbers, questions, notes or credentials. Membership removal deletes that member's alerts through the foreign key.

## Verification

Before release, a temporary Git index must prove that reversing the patch restores the exact baseline application tree, and that retaining only the schema and applied migration yields the intended rollback. Disposable PostgreSQL tests verify concurrent retries, read-state retention, current recipient permissions, obsolete work, exact key constraints and membership deletion.

Production verification uses mocked browser mutations and read-only API/SQL checks. Never invoke the real notification sweep as a test, create test production alerts/CRM records, activate a widget, or read/decrypt/use the saved DeepSeek key or call an AI/phone provider.
