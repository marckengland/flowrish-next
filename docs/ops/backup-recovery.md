# Backup and recovery

## Readiness recorded on 4 November 2026

**Synthetic recovery tooling passed. Production recovery is not yet proven.** No production data was exported, restored, or changed during this check.

| Item | Read-only evidence | Status |
| --- | --- | --- |
| Supabase project | `ilkfauwpjyrqcowlzwtz`, healthy, `ap-southeast-1`, PostgreSQL 17.6.1.121 | Confirmed |
| Organization plan | Connected organization metadata reports Free (`tier_free`) | Confirmed |
| Scheduled daily backups | Free does not include automatic daily backups | Not available on current plan |
| Manual or paused-project snapshots | The connected tools cannot list backups; the browser console requires sign-in | Unverified |
| Off-site backup, encryption, retention, latest successful copy | No inventory was available to this check | Unverified |
| Production recovery point or recovery time | No real backup restore was authorized | Unverified |
| Receptionist widget | One configuration, zero enabled; aggregate query only | Off |

Supabase recommends regular off-site exports for Free projects. A successful synthetic drill does not establish a production recovery point. Do not describe recovery as ready until there is a verified real backup, its required external assets and keys, and an approved isolated restore test. See [database backups](https://supabase.com/docs/guides/platform/backups), [Free plan backups](https://supabase.com/kb/faqs/platform/free-plan-backups), and the [read-only backup inventory endpoint](https://supabase.com/docs/reference/api/v1-list-all-backups). Platform terms can change; check them when choosing a backup policy.

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

Lead and Task RLS with zero policies, and the knowledge tables' revoked browser-role privileges, were modeled from a catalog-only production read. This does not claim that all live schema drift or application authorization was audited. Rebuilding from Prisma alone would miss this observed Lead/Task RLS state; use a real logical archive for a future real-data recovery test.

Successful reports are written to ignored `test-results/recovery-drill/report.json`. They contain only versions, counts, digests, timings and check names. The synthetic archive is discarded. A new CLI run removes stale success evidence. Cleanup failure prevents success. If the process or Docker daemon is forcibly killed, inspect only the exact `flowrish-recovery-<UUID>` container from that run, verify its matching `flowrish.recovery-drill=<UUID>` label, network `none` and lack of host mounts, and remove that owned container. Never use a Docker prune command or remove another project's container. Temporary directories use the same `flowrish-recovery-` prefix under the OS temporary directory.

## Observed drill result

On 4 November 2026, the cached PostgreSQL 17.11 image restored **67 tables, 27 application rows and 34 migration rows**. All 13 reported checks passed, including corrupt/archive interruption, nonempty-target refusal, data/catalog comparisons and source/control preservation. The archive was about 200 KiB; the measured restore step was 208 ms and the complete drill took about 9 seconds. These are synthetic local timings, not a production recovery-time commitment. The report's exact duration and archive digest vary on rerun because fixture creation times and ledger IDs are generated locally.

## What a real recovery would still require

Before accepting production records, agree on acceptable data loss (RPO), acceptable downtime (RTO), an owner, and a verified backup schedule. Within the current no-spending constraint, first inventory any existing manual/off-site copies and determine whether an owner-operated encrypted export is feasible. No export, schedule, storage service or upgrade was created here.

Keep these recovery inputs separate and access-controlled:

- A complete, current database backup and its timestamp, PostgreSQL compatibility, migration state, custom privileges and roles. This drill uses one PostgreSQL major version and a public application schema; it does not exercise Supabase managed schemas, Auth accounts/sessions, extensions, custom role recreation or role passwords.
- Storage **object bytes**, including the `attachments` bucket, together with their metadata. Supabase database backups do not include Storage object bytes. This drill does not download or inventory files.
- Required deployment configuration and external encryption keys, including the location and recovery owner for `EMAIL_ENCRYPTION_KEY`. Never put key values in this runbook, Git, reports or logs. Restoring encrypted database rows without the matching key does not restore their use.
- External provider reconnection and token-rotation procedures. This drill neither decrypts keys nor calls DeepSeek, email providers or telephony services.

During an actual incident, the owner must authorize any hosted restore, downtime, spending, credential use and write suspension. Identify the last verified backup and its data-loss window, preserve the current state, and test restoration into an approved isolated destination before switching traffic. Reconcile Auth, Storage and keys; validate tenant isolation, migrations, callbacks, search and widget state; then approve resuming writers. A full snapshot restore can lose newer records across every organization and is not a routine code rollback.

## Rollback and limits

Antidote: revert this tooling commit; no production schema, settings or records were changed. No migration was added. Do not restore a production snapshot or edit an applied migration to undo these scripts.

Not tested: a real production archive, hosted restoration, all managed schemas, actual user sign-in after restoration, full application authorization against restored data, Storage files, encryption-key escrow, role passwords, PITR, off-site retention/encryption, point-in-time guarantees, cross-major upgrades, or recovery after loss of the local machine. No new dependencies or paid services were introduced. The widget stays off and the drill makes no AI or email requests.
