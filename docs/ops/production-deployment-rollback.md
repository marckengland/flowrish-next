# Recover a production deployment

This procedure is for maintainers of an installation they control. Keep the production release gate enabled while investigating a failed release. A code rollback does not undo an applied migration or restore business data.

## Select a compatible deployment

Record the current release commit, schema version, and intended recovery deployment privately. Check whether older code can safely read current records, calendars, retry receipts, and credential configuration. Retain additive schema and duplicate-protection guards when required by the feature runbook.

Use your hosting provider's authenticated deployment tools to restore a reviewed, compatible deployment. Inspect the active alias after the operation. If its result is uncertain, read status before retrying. Do not disable a gate, restore a whole database, delete applied migrations, or enable reception to test recovery.

## Understand the maintainer-specific helper

`scripts/production-rollback.mjs` pins a particular Flowrish project and historical deployment. It is not a general rollback tool for forks, and its recorded target must be reviewed for compatibility before every use. Public project and deployment identifiers are not credentials. The helper must continue rejecting other projects and ambiguous alias state.

Do not run it merely because production is unavailable. First review its pinned target, the current schema, and every feature's retained-record requirements. A healthy historical deployment can still be incompatible with newer stored data. Configure and test a separate recovery process for your own installation.

## Change the release process only after review

A failed candidate can remain blocked while it is repaired. If the release mechanism itself must change, keep a verified alias active, stop queued candidates from promoting, and review the workflow, hosting check, environment branch policy, and migration ordering together.

Identify each installation's own check IDs, branch policy, and secret metadata through its authenticated administration interface. Preserve unrelated protections and credentials. Do not copy historical maintainer settings or assume an environment was originally empty. Never print secret values or commit operational readbacks.

After restoring availability, rerun the appropriate read-only smoke checks and the affected synthetic regressions. Keep execution results outside public source. Mocked helper tests cannot establish that a live recovery deployment is compatible with the current installation.
