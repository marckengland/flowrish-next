# Rehearsal FAQ drafts rollback

Before release on 2026-11-02, production main was `bde75ef0807368a82d1058549a00b676ab9ad58e`. A read-only schema query confirmed that `RehearsalFaqDraft` was absent, `ReceptionistRehearsal` and `KnowledgeDocument` existed, and the latest applied migration was `20261102100000_add_receptionist_rehearsal_reports`.

The new migration adds one private link table and one unique index. It changes no existing document, report, approval, customer record, credential, or business setting.

## Recover

If draft creation or source navigation fails after release, revert the application change while preserving the applied migration and Prisma schema:

```sh
git log --oneline --first-parent --grep='Merge rehearsal FAQ drafts'
git revert --no-commit -m 1 <merge-commit-from-the-log>
git restore --source=HEAD --staged --worktree -- prisma/schema.prisma prisma/migrations/20261102110000_add_rehearsal_faq_drafts/migration.sql
git commit -m 'Disable rehearsal FAQ draft workflow'
```

Deploy the rollback using the normal release process. Recovery takes one normal deployment, typically several minutes. The previous application can use the additive schema; saved FAQs, their approvals, and provenance remain intact. Browser roles retain no access to the origin table.

Do not drop the table or index, delete generated FAQs, edit or remove the applied migration, force-push, or restore a full database snapshot. A code rollback does not recover an admin-deleted rehearsal or independently undo a manual publication.

## Evidence

The disposable PostgreSQL suite verifies private-draft defaults, the shared document cap, concurrent retry safety, stale/unflagged/member rejection, composite tenant foreign keys, source isolation from published answers, and FAQ retention after report deletion. No provider transport is used.

A temporary Git index checks that reversing the full staged diff restores the previous tree exactly. Restoring only the unchanged applied migration and schema then leaves the previous application code with the additive database declarations. This verification does not mutate the working tree or database.
