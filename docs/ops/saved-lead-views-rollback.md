# Saved lead views rollback

Baseline: `3d1207135731fd7ff0004523db92b5b4941b6f08`.

The new migration creates one private preference table, index and constraints. It inserts no rows or changes to leads, tasks, email, providers or widget configuration.

A catalog check also confirmed default table grants to browser roles. The migration therefore wraps creation and privacy statements in one PostgreSQL transaction. A local injected failure before the RLS statement rolled back the table completely. The successful migration revoked the modeled default grants and passed the ownership, revision and membership-cascade checks.

## Undo the feature while preserving views

If the saved-view API or controls cause failures, revert the saved-views application commit in a recovery branch, retaining its Prisma schema and migration:

```sh
git revert --no-commit <saved-views-commit>
git restore --source=<saved-views-commit> --staged --worktree -- prisma/schema.prisma prisma/migrations/20261105000000_add_saved_lead_views/migration.sql
```

Review the recovery diff and run the configured checks before committing and deploying through the normal release gate. The older application ignores the retained table; preferences remain available if the feature is restored. Recovery takes a normal code deployment and does not require a database restore. It cannot undo a preference that a user already deliberately deleted or changed.

The retained-schema inverse must produce a tree equal to the baseline except for `prisma/schema.prisma` and the new migration. Verify that proof in a temporary Git index before shipping. Local PostgreSQL checks must keep other memberships' views when one membership is deleted and must reject browser-role access.

Do not drop the table, delete saved preferences, remove the applied migration from history, restore a production snapshot, weaken ownership/RLS, or enable the receptionist widget as part of rollback. A real backup and hosted recovery remain separate, deferred work.
