# Follow-up snooze implementation plan

Use executing-plans inline with one fresh whole-branch review. Spec: docs/superpowers/specs/2026-11-05-follow-up-snooze.md. Existing Node22/Prisma/React stack; no dependencies.

1. RED→GREEN local-time conversion and scoped snooze policy, version/ownership/resolution/wait cases. Add private additive migration41 and shared SQL visibility predicates. Retain existing callback-time assertions.
2. Add pending/Snoozed filtering and metadata, revision-keyed in-app reminder sources/count/list/read/focused behavior. Preserve mailbox proof, receipt rechecks and current owner access. Extend approved existing fixtures without dropping assertions.
3. UI tomorrow/custom/wake, draft discard confirmation, privacy/late-response/uncertain handling; broaden alert labels/kind and deep links. Add6 approved browser scenarios retaining106 and guards. Verify narrowly while iterating.
4. Full checks, synthetic PostgreSQL privacy/time/ownership/resolve/read-revision/concurrency proof, tested recovery pause, fresh review and one RED→GREEN fix pass. Merge/push, verify all CI and exact production SHA plus catalog/anonymous/widget state read-only. Archive own scratch; preserve protected checkout and unrelated changes.

Review focus: no resolved work resurrection; callback task ownership before/after handoff; source-mailbox proof for email vs no-mailbox callbacks; reminder revision/read race; database-vs-client time; ambiguous local minutes; expired snooze retains no hidden authority; due list fairness and retained drafts; stale poll responses; no automatic sends or policy bypass.
