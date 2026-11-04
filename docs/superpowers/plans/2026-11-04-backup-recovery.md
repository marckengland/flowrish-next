# Backup and recovery readiness

> **For agentic workers:** Use superpowers:executing-plans inline, with one final fresh review.

**Goal:** Record read-only backup readiness and run a repeatable, synthetic PostgreSQL dump/restore drill without production changes.

**Spec:** The user's approved backup/readiness check and local synthetic restore drill. No dependencies or paid services, production data changes, widget activation, provider calls, or real records in drill archives.

**Architecture:** A standard-library Node CLI uses the already-cached PostgreSQL 17 image through a verified local Unix Docker socket. It creates one labeled, network-disabled container without ports or mounts, copies the repository schema/migrations into an owned temporary directory, validates with explicit loopback-only Prisma configuration, and applies the reviewed migration SQL through `docker exec psql`. Only fixed local source, restored, and control databases are used. `pg_dump` produces a custom-format synthetic archive; `pg_restore --single-transaction --exit-on-error` restores it. No external database URL or archive is accepted.

**Readiness evidence:** Connected Supabase tools verified the Free organization plan, PostgreSQL 17, zero enabled widgets, and catalog-only RLS/ACL metadata. The connector has no backup-list operation; manual/paused snapshot inventory and any off-site backup remain unverified. Free does not include scheduled daily backups. No upgrade or backup export is part of this task.

**Constraints:** Preserve unrelated `.serena/` and `.spec-workflow/`. Never use `prisma db push` or root datasource configuration. Never read or forward real provider/database credentials, use other containers, publish ports, pull images, mount host directories, or restore production. Existing tests may only be corrected with approval. Run configured checks; strict and fast types follow the root build.

**Review focus:** Reject remote Docker endpoints before mutation; verify container ownership/network isolation before exec/removal; withhold raw subprocess output; compare all application table counts/digests plus constraints/indexes/triggers/RLS/ACL; verify rollback after a restore error and unchanged source/control databases. Cleanup failure must prevent a successful report.

## Task 1: Implement and verify the bounded drill

- [x] Write mocked safety regressions, observe missing implementation fail, then implement `scripts/recovery-drill.mjs` and synthetic SQL under `scripts/recovery/`.
- [x] Run the real isolated drill with the cached PostgreSQL 17 image. Verify two organizations' CRM relationships, published/draft/approved knowledge, direct-role denial, cross-tenant chunk constraints, FTS trigger/index, and exact source/restored fingerprints.
- [x] Exercise a corrupt archive, a nonempty target, and a deliberately interrupted transactional restore. Confirm original source and control data stay unchanged and the owned container is removed.
- [x] Add the npm command and a recovery/readiness runbook with observed results, prerequisites, coverage, and gaps. Run full tests, lint, build, strict/fast types and mocked browser rehearsal. Get one fresh whole-branch review and cover material findings with regressions.

Integration procedure: prove a normal code reversal restores baseline `89149fe855caf1f98f1be62cd38d73822d52d407`, commit/merge, test the merged tree, push under session authorization, and verify CI/deployment/live smoke and widget-off metadata.

## Limits and rollback

This is a tooling drill, not proof that a real production backup restores. Database records are synthetic. Supabase Auth sessions/users, custom role passwords, Storage object bytes, external encryption keys, PITR, off-site encryption/retention, cross-version upgrades, and hosted restoration remain unverified. Database RLS for the four tested tables is modeled from the read-only catalog baseline; this is not an application-authorization test. The synthetic migration ledger is reconstructed from checked-in versions/checksums, not copied from production.

Rollback is a code revert only. The drill removes its own temporary resources. Never restore a production snapshot, edit applied migrations, delete stored customer data, weaken the release gate, or change provider/widget settings to undo this tooling.
