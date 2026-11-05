# Safe lead merges: release and recovery

## Recorded baseline

Read-only checks on 2026-11-05 confirmed production commit `4272c397b1a4a7a0c9b81ebf288ca2b2680a7c51`, Vercel deployment `dpl_985cGHFGWb6a6U1FBwjEES5Bzt8B`, and project `prj_AFfVtIp4EO7TqUmIzBYDzDPI8zeb`. The database had 36 finished migrations, no `LeadMergeReview` table or `Lead.mergedIntoId` column, and zero enabled website receptionist widgets. No real lead data or credentials were retrieved.

Migration `20261105020000_add_safe_lead_merges` atomically adds the archive marker/relation, private review table, constraints, and writer guards. RLS and browser-role privilege revocation take effect in the same transaction as table creation. Existing rows have a null merge marker and keep their previous behavior. Guards prevent new links or edits to a merged archive and require an active retained lead in the same business.

The link guard covers the ten current `leadId` tables: Activity, Task, LeadContact, StageTransition, ScoreHistory, CadenceEnrollment, FollowUpSuggestion, ReceptionistCall, WaitlistCrmHandoff, and CallbackCrmHandoff. A future table referencing lead IDs must be added to the guard registry and merge review before its records can participate safely.

## Verification evidence

The isolated browser suite retains all 76 prior scenarios and adds six merge scenarios. They cover desktop/mobile preview and explicit keyboard confirmation, choosing either retained record, workflow blockers, stale data/access, uncertain-result replay, read-only controls, and transferred email-history visibility. External-network and unexpected-write guards remain enabled. Unit/property checks retain the original activity-union, contact-deduplication, primary-field, and self-merge invariants.

An owned PostgreSQL 17 container ran without external networking, mounts, or published ports. A temporary loopback-only byte bridge connected a Prisma client configured explicitly for that container. The real merge service, permissions, SQL guards, and operator undo ran against invented business records. The project `.env` and Prisma root configuration were not used for setup; schema SQL was generated offline from a temporary explicit configuration. No dependencies or images were downloaded.

Observed checks:

- All 37 migrations applied. Injected DDL failure left no review table or merge-marker column. RLS and browser-role denial held under permissive default grants.
- Changed task data and workflow links blocked confirmation. Revoking permission while apply waited on a lead lock caused a 403 before any transfer.
- A late task insertion waited behind the merge, then failed after the source was archived. No orphan task appeared.
- Real audit and receipt failures rolled back every transfer, contact copy, archive, audit entry, and applied receipt.
- Successful merging retained primary fields and archived source fields, transferred tasks/activity/history, preserved linked email and file IDs, and deduplicated contacts. Same-ID retry did not repeat the operation.
- Archived merged rows rejected edits and deletion. Applied manifests survived membership removal while the former actor’s API access was denied.
- Operator undo refused later additions, deletions, and edits without partially restoring anything. With unchanged invented records, it restored the archive and exact transferred rows, removed only copied contact links, wrote two repair audits, and made a second run a no-op. Another organization’s data stayed unchanged.

Final local checks passed: 2,145 unit tests across 317 files, all 82 mocked browser scenarios, ESLint, production build, and strict/fast TypeScript checks. Independent whole-branch review and focused fix review found no remaining material issues. The confirmation-disable tree passed 2,146 tests, including its actual disabled-policy guard, and the fast TypeScript check.

Owned containers, bridge processes, and temporary schema files were removed. Production verification uses anonymous GETs and read-only catalog checks. No production merge, data repair, email, AI request, or widget activation is part of verification.

## Disable merge confirmation

Signals include incorrect previews, repeated confirmation errors, or an inability to retrieve a confirmed receipt. The prepared local `antidote/safe-lead-merges` branch changes `leadMergeWritesEnabled()` to false and adds a test proving the real disabled policy rejects confirmation before the service runs. It retains archive markers, guards, receipts, audit history, and all data-preservation code. After explicit approval, cherry-pick its tip onto current main, run the repository checks, and push through the normal release gates.

Confirmation and receipt-retry requests are unavailable while this switch is disabled. Previews and read-only lead history remain available. Inspect audit history when investigating an uncertain request. Expect a normal CI/deployment cycle; observe the actual timing.

Do not revert to the old destructive merge endpoint, drop the marker/table/guards, edit an applied migration, rewrite main, or restore an entire database snapshot to disable this feature. A code disable does not undo completed merges.

## Restore one unchanged merge

[undo-lead-merge.sql](../../scripts/recovery/undo-lead-merge.sql) changes business data and requires explicit approval for the exact organization, review, and acting user. It is never executed during deployment or application startup. Inspect the review and audit entries first. Provide `organization_id`, `review_id`, and `actor_id` to `psql --no-psqlrc -v ON_ERROR_STOP=1` through an approved database connection. Keep credentials out of shell history and logs.

The repair locks the review, both leads, relevant memberships, and related rows. It requires the exact post-merge lead hashes and related-row sets to remain unchanged. The archived owner must still be a business member. Otherwise the entire repair is refused and needs individual review; do not remove the predicates or revive departed memberships to force it.

For an unchanged merge, the SQL restores the archived lead, returns only manifest-listed records, removes only copied contact links, advances timestamps, and writes repair audit entries in one transaction. It marks the review as undone so a repeat changes nothing and the application rejects old confirmation retries. It does not send messages or repair unsupported workflows.

Applied manifests are durable business audit records. Any future retention or erasure policy must coordinate manifests, archives, and audit evidence. This drill does not verify an off-site backup or a production restore; backup setup remains deferred by the user.
