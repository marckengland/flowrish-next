# Roll back saved compose recovery

If private saving errors or restore conflicts increase, turn back the feature's runtime code while keeping its additive schema and encrypted rows. Recovery becomes unavailable; current unsaved text still requires the user to keep its tab open. Re-enabling corrected code can read the retained copies. No provider action or send is part of rollback.

Use a new rollback branch from current main. Revert the saved-draft feature commit without committing, then capture the pre-rollback HEAD and restore these paths from that captured HEAD before reviewing and committing the rollback:

- `prisma/schema.prisma`
- `prisma/migrations/20261109010000_add_follow_up_compose_drafts/`

This preserves the applied migration, private table and any later schema additions. Do not replace the current schema with an older feature-era copy. Revert the feature's CI step, runner changes and npm command together, retaining the existing release gate and inbox regression job. Keep `EMAIL_ENCRYPTION_KEY` unchanged. Run the full checks and deploy the rollback through normal CI. Prepare and verify the selective inverse against your current release before deployment; keep execution evidence privately.

The disposable database drill verifies baseline CRM queries and records remain identical with the additive table retained, and private rows remain encrypted and inaccessible to browser roles. Repeat reads leave the same data intact. Runtime rollback takes a normal tested deployment; it does not recover edits that were never acknowledged online.

Do not drop the table, delete draft rows, remove an applied migration, restore a whole production database, change encryption keys, force-push main, or bypass the production gate. These actions can lose unrelated or recoverable work.
