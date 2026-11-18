# Receptionist performance rollback

Baseline: `28ef742c1ab7d2579842a6e8ac62f44b05bb5534`. This release adds a read-only dashboard and GET API. It adds no schema, migration, dependency, provider call, persistent configuration, or scheduled job. A normal code revert is the antidote; nothing else persists.

If counts disagree with their definitions, access fails, or the report cannot load, revert the merge and redeploy through the normal pipeline:

```sh
git log --oneline --first-parent --grep='Merge receptionist performance dashboard'
git revert -m 1 <merge-commit-from-the-log>
```

Recovery takes one deployment. No database rollback or Inngest registration change is required. Do not drop callback tables, delete handoff/outcome receipts, edit applied migrations, restore a full database snapshot, or force-push.

Before release, a temporary Git index must prove that reversing the staged feature patch restores the exact baseline tree without changing existing callback workflows. Disposable PostgreSQL tests compare real cohort counts, medians, permissions, current owner filters, retained handoffs, active flags, and pagination. Production verification uses mocked browser writes and read-only GET/SQL checks. Never create production test callbacks, enable a widget or response policy, run a sweep as a test, or retrieve/decrypt/use the saved AI key.
