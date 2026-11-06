# Recover bulk Approved task completion

Baseline: `585b34e436595372c00a83827d548d4c612ce9ee`.

Bulk completion uses the existing per-task preview, completion and exact-request receipt endpoints. It adds no dependencies, migrations, stored settings or server API contracts. Up to20 unique linked tasks are reviewed, then submitted sequentially after explicit confirmation. The queue stops on the first error. Checking results uses GET and never repeats a completion or submits unattempted tasks.

If the controls malfunction, revert the bulk-completion application commit and deploy through the normal release gate:

```sh
git revert --no-commit <bulk-task-completion-commit>
```

Review the diff, run the configured checks, then commit and deploy. The existing single-task controls remain available. The pre-release code inverse/reapply check must reconstruct the exact baseline and feature trees.

Completed tasks, lead activities and exact-request audit receipts remain valid after a UI rollback. A code revert cannot reopen tasks already completed by a user. Inspect any disputed task individually in CRM; do not automatically reopen a batch, delete its activity/audit history, or restore the whole database. Recovery takes a normal code deployment.

A lost response may follow a committed completion. Use Check completion results before clearing the selection; it reads the exact request. A confirmed result does not continue the remaining queue. Clear the selection, review the remaining open tasks, and explicitly confirm a new batch. Clearing or leaving the inbox loses the browser's unfinished review and request-check state. It does not undo completed work. If the browser is closed, inspect task progress and recorded task activity before another attempt.

The disposable PostgreSQL drill verifies10 completed tasks,10 activities and10 audit receipts, duplicate replay and concurrent duplicate protection, partial failure, GET-only receipt checks, reassignment and foreign-business denial, manager task scope, stale-account queue stopping, unchanged source/unrelated records, and compatibility with the unchanged baseline reader. All records are synthetic. Production verification uses anonymous reads and read-only migration/widget aggregates.

Keep the widget off. Do not use AI/email providers, weaken authorization or review versions, bypass the release gate, change applied migrations, or force-push to diagnose or recover this feature. Cross-device persistence of unfinished reviews, atomic batch completion, automatic retries, bulk reopening and live-provider behavior are outside this release.
