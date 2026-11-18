# Backup and recovery

Assess backups for your own installation. A synthetic restore does not prove production recovery readiness. Record the backup owner, schedule, retention, encryption, storage objects, required keys, and an approved isolated restore result privately. Verify current backup capabilities with your hosting provider.

## Run the synthetic drill

Prerequisites: the repository's installed dependencies, Node 22, a local Docker Unix socket, and an **already cached** `postgres:17` image. The command never pulls an image or installs anything. It uses the image's immutable inspected ID and checks the running PostgreSQL major version.

```sh
npm test -- src/__tests__/recovery-drill.test.ts
npm run test:recovery:synthetic
```

There are no target or archive arguments. Do not add a production URL to this command. It does not import dotenv, access the root Prisma configuration, or forward datasource/provider credentials. Prisma validation runs from an owned temporary copy with an explicit configuration and an unusable loopback dummy URL. Reviewed migration SQL is applied offline through `docker exec psql`; the command never uses `prisma db push`.

The runner creates one randomly named, labeled container with networking disabled, no published ports or host mounts, and a memory-backed data directory. It verifies the container's exact identity, label and isolation before every exec or removal. It uses only the fixed local `source`, `restored` and `control` databases inside that container. The precreated `anon` and `authenticated` roles are synthetic, have no login, and have no passwords.

The fixture contains two organizations with related users, members, companies, contacts, pipelines, stages, leads and callback tasks; three knowledge documents; two published chunks; and two disabled widget configurations. Knowledge fixtures distinguish a newer private draft from an older published and approved snapshot, an unpublished draft, and another organization's unapproved publication. Migration versions and checksums are reconstructed from the repository; they are not evidence about the hosted migration ledger.

`pg_dump --format=custom --no-owner` creates the archive in memory. `pg_restore --single-transaction --exit-on-error --no-owner` restores into the empty local target. The runner checks:

- Counts and content digests for every public table, including empty tables and the synthetic migration ledger.
- Columns, defaults, constraints, indexes, enum values, functions, triggers, RLS flags, table privileges and policies. PostgreSQL's pretty constraint deparser compares definitions without irrelevant nested-AND parentheses introduced by dump/restore.
- Both tenants' CRM relationships, knowledge publication/approval boundaries, the full-text GIN index and an update-trigger test rolled back afterward.
- Anonymous and authenticated direct-role denial for Lead, Task and knowledge tables; cross-tenant knowledge foreign-key and orphan-task rejection.
- Rejection of a corrupt archive without target changes, a forced error after earlier tables have been created with complete transaction rollback, and refusal to restore over a populated target.
- Unchanged source, restored and separate control fingerprints after the probes; removal of the owned container and temporary files before reporting success.

The synthetic fixture models Lead/Task RLS with no policies and revoked browser-role knowledge privileges. It is not an audit of your live schema or application authorization. A real logical archive must retain the installation's own roles, privileges, and schema drift.

Successful reports are written to ignored `test-results/recovery-drill/report.json`. They contain only versions, counts, digests, timings and check names. The synthetic archive is discarded. A new CLI run removes stale success evidence. Cleanup failure prevents success. If the process or Docker daemon is forcibly killed, inspect only the exact `flowrish-recovery-<UUID>` container from that run, verify its matching `flowrish.recovery-drill=<UUID>` label, network `none` and lack of host mounts, and remove that owned container. Never use a Docker prune command or remove another project's container. Temporary directories use the same `flowrish-recovery-` prefix under the OS temporary directory.

## What a real recovery would still require

Before accepting production records, agree on acceptable data loss (RPO), acceptable downtime (RTO), an owner, and a verified backup schedule. Inventory existing copies and choose a backup process appropriate to those requirements. This tooling does not create production exports, schedules, or storage services.

Keep these recovery inputs separate and access-controlled:

- A complete, current database backup and its timestamp, PostgreSQL compatibility, migration state, custom privileges and roles. This drill uses one PostgreSQL major version and a public application schema; it does not exercise Supabase managed schemas, Auth accounts/sessions, extensions, custom role recreation or role passwords.
- Storage **object bytes**, including the `attachments` bucket, together with their metadata. Supabase database backups do not include Storage object bytes. This drill does not download or inventory files.
- Required deployment configuration and external encryption keys, including the location and recovery owner for `EMAIL_ENCRYPTION_KEY`. Never put key values in this runbook, Git, reports or logs. Restoring encrypted database rows without the matching key does not restore their use.
- External provider reconnection and token-rotation procedures. This drill neither decrypts keys nor calls DeepSeek, email providers or telephony services.

During an actual incident, the owner must authorize any hosted restore, downtime, spending, credential use and write suspension. Identify the last verified backup and its data-loss window, preserve the current state, and test restoration into an approved isolated destination before switching traffic. Reconcile Auth, Storage and keys; validate tenant isolation, migrations, callbacks, search and widget state; then approve resuming writers. A full snapshot restore can lose newer records across every organization and is not a routine code rollback.

## Rollback and limits

Antidote: revert this tooling commit; no production schema, settings or records were changed. No migration was added. Do not restore a production snapshot or edit an applied migration to undo these scripts.

Not tested: a real production archive, hosted restoration, all managed schemas, actual user sign-in after restoration, full application authorization against restored data, Storage files, encryption-key escrow, role passwords, PITR, off-site retention/encryption, point-in-time guarantees, cross-major upgrades, or recovery after loss of the local machine. No new dependencies or paid services were introduced. The widget stays off and the drill makes no AI or email requests.
