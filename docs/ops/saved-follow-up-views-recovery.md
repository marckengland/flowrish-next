# Recover saved follow-up views

Baseline application: `7d73c3d4dae574d4f816fc7b02ad9c469438dafd`.

Migration `20261106000000_add_saved_follow_up_views` adds one private preference table, constraints and an index. It changes no existing records or widget settings.

If the new controls or API cause failures, revert the feature's application changes in a recovery branch while retaining the additive Prisma model and applied migration:

```sh
git revert --no-commit <saved-follow-up-views-commit>
git restore --source=<saved-follow-up-views-commit> --staged --worktree -- prisma/schema.prisma prisma/migrations/20261106000000_add_saved_follow_up_views/migration.sql
```

Review and test the recovery change, then deploy it through the normal release gate. Recovery takes a normal application deployment. The previous application ignores the new table, preserving saved views if the feature is restored. It cannot recover a view deliberately edited or deleted by a user.

Before shipping, verify that this retained-schema inverse produces the baseline application tree except for the Prisma schema and new migration. The disposable PostgreSQL drill must prove that failed DDL leaves no partial table, default browser grants are revoked, concurrent edits and limits are enforced, other users' views survive membership removal, and legacy lead-view operations still work with the new table retained.

Do not drop the table, delete users' views, edit an applied migration, force-push history, restore the whole production database, or enable the widget to recover this feature. Hosted backup setup remains deferred.
