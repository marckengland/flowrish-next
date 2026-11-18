# Knowledge gaps inbox rollback

This release adds only manual review metadata. There is no migration backfill, report update, FAQ publication, credential change, or customer-data rewrite. Reading the inbox contacts no AI or phone provider.

## Recover

If the inbox fails after release, disable its application code while preserving the applied migration and additive schema:

```sh
git log --oneline --first-parent --grep='Merge knowledge gaps inbox'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103010000_add_knowledge_gap_reviews/migration.sql
git commit -m 'Disable knowledge gaps inbox'
```

Deploy this rollback normally. Recovery takes one normal deployment, typically several minutes. Existing reports, FAQ drafts/publications/approvals, and manual inbox reviews remain stored. The previous application can use the additive schema. Browser-role access to the review table stays revoked.

Do not drop the table, delete reports or FAQ drafts, edit/remove an applied migration, force-push, or restore a full database snapshot. A code rollback does not undo an admin's independent manual document publication or removal.

## Evidence

The disposable PostgreSQL suite verifies cross-history grouping, tenant permissions, pagination, FAQ states, retest confirmation, stale reviews, source-change reopening, concurrency, and private table privileges. A trigger/advisory-lock handshake exercises publication racing with resolution without relying on scheduling sleeps. Existing report flags, verdicts, business settings, provider configuration, usage budgets, and CRM data remain unchanged by review actions.

A temporary Git index verifies the full feature revert restores the previous tree. Restoring the unchanged schema and applied migration then leaves exactly the previous application with the additive database declarations. No working-tree or database writes are used for this rollback check.
