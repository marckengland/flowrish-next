# Website receptionist rollback

The migration adds four private tables with RLS enabled and browser-role grants revoked. It performs no data backfill or changes to existing settings, credentials, library content, or CRM records. No organization is enabled by the migration. Verification uses mocks and disposable data; it does not use the saved provider key or enable a production widget.

## Recover

If an administrator has enabled the widget, disable it in the organization's website settings to stop new public requests and invalidate active sessions. Preserve the prior settings and record the change. Already running provider requests may complete within their timeout.

For an application regression, deploy the previous application while retaining the additive database declarations and applied migration:

```sh
git log --oneline --first-parent --grep='Merge organization website receptionist'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103020000_add_website_receptionist/migration.sql
git commit -m 'Disable organization website receptionist'
```

Deploy through the normal pipeline. This removes the public routes, assets, settings UI, and cleanup registration. It preserves confirmed callback records and quota/session metadata for recovery. The old application tolerates the additive tables. Recovery takes one normal deployment.

Do not drop tables, remove an applied migration, restore a full database snapshot, force-push, or change provider credentials. A code rollback does not undo staff callback reviews or deletions. If only this feature's cleanup is removed, its stored sessions and quotas remain until cleanup is reinstated or handled explicitly.

## Undo verification

A temporary Git index checks that reversing the feature restores the base tree, then restores only the additive Prisma schema and migration. The disposable PostgreSQL suite verifies migration privacy, concurrency, quota limits, cross-organization isolation, session invalidation, retries, consent, callback retention, and absence of CRM writes. These checks do not mutate production data.
