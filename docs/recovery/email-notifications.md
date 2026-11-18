# Recover email notifications

If counts, focused links, or acknowledgments misbehave, compare the current source and access with the notification rather than modifying message routing. Notification reads never create tasks, send emails, or change source decisions.

## Baseline and data boundary

Migration `20261105040000_add_email_notification_reads` adds only EmailNotificationRead, its composite primary key, key-format constraint, membership foreign key, RLS, and browser-role revocations. It does not insert receipts, rewrite business records, or add browser access policies. Receipts are created only by an explicit authenticated acknowledgment. The receipt table can remain when notification code is reverted.

## Code rollback

Use an isolated recovery branch from a clean current main. Do not reset or overwrite unrelated changes. The tested procedure reverts the feature's application code, then restores the additive Prisma schema and migration from the release so an applied migration is never removed.

The feature commit is `8fc4f5193341b418c282527439725018bbed7d27`. From a clean checkout of the release being recovered:

```sh
git switch -c codex/pause-email-notifications
git revert --no-commit 8fc4f5193341b418c282527439725018bbed7d27
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261105040000_add_email_notification_reads
```

Stop and review any conflict or later feature dependency; never force or discard another change. Run the repository checks with safe fixtures, then commit the reviewed rollback and use the normal production release process. HEAD remains the pre-revert release until that commit, so the restore preserves its Prisma schema and all applied migration files. Production recovery requires a separately reviewed deployment; no automatic rollback runs in the application.

Do not delete receipts to clear current alerts: eligibility comes from current pending work, so unread alerts would reappear. Resolve the actual work or correct its access with the existing workflow. Do not drop the receipt table, edit an applied migration, restore a full production snapshot, change mailbox checkpoints, enable the widget, or use a live AI/email provider to test recovery.

A code rollback removes email notifications from the UI; it does not undo prior personal acknowledgments. It leaves callback notifications, email sync, merge-aware routing, and explicit sending approval intact. Re-enabling the feature can use the retained receipts. Offboarding continues to remove receipts through its membership foreign key.

## Verification

The synthetic PostgreSQL 17 drill applied all 39 migrations and verified transactional DDL failure rollback, revoked browser access, key validation, membership cascade, stable source identities, current source/lead/mailbox eligibility, concurrent acknowledgment replay, and rollback when work resolves or permission is revoked during a wait. Its container and temporary database were removed. The drill and provider checks used synthetic data; no production business records were changed.
