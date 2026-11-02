# Callback outcomes rollback

Before release on 2026-11-03, main was `f9d25efae16f8a44466009333d6211d0d1507148`. A read-only production query confirmed `CallbackOutcomeEvent` was absent. The migration adds only that private history table and its organization relation, constraints and indexes. It backfills no history and changes no existing callback, receipt, CRM task, provider setting or widget activation.

## Recover

If outcome management regresses, remove the new UI and API through the normal deployment pipeline while preserving history:

```sh
git log --oneline --first-parent --grep='Merge callback outcome tracking'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261103040000_add_callback_outcomes/migration.sql
git commit -m 'Disable callback outcome tracking'
```

Recovery takes one normal deployment. Existing callback handoffs and normal task management keep working. History remains private and stored for reinstatement. No applied migration is removed or edited.

A code rollback cannot undo staff-reported results, approved task completion/reopening/reassignment/deadline changes, callback review changes, or CRM notes. Correct CRM work deliberately through its normal screens; do not bulk-delete history or restore stale task/lead snapshots over later edits. Never drop the history table, restore a full database snapshot, or force-push.

## Verification

A temporary Git index verifies that reversing the feature restores the previous application tree. Preserving only the additive Prisma schema and applied migration produces the intended rollback; repeating preservation changes nothing. Disposable PostgreSQL tests verify private privileges, exact retries, concurrent state changes, tenant/owner/membership checks, history retention, pagination and atomic rollback of a failed CRM note write.

Production verification uses mocked browser mutations and read-only endpoint checks. It must create no real callback outcome, task, lead, note or receipt, must not activate a widget, and must not read/decrypt/use the saved DeepSeek key or call a provider.
