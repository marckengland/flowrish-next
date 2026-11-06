# Recover bulk Approved deadline rescheduling

Baseline: `6e7e177f5cababfdc33ff326d0687182928144bc`.

The controls reuse the existing task-reschedule preview, confirmation and exact-request receipt endpoints. They add no packages, migrations, stored settings or server contracts. Up to20 unique open Approved tasks share one chosen local minute and IANA timezone. Every task's old/new UTC deadline is reviewed before explicit confirmation. The server enforces current task access, unchanged review versions and a future deadline different from the current deadline.

Confirmation sends sequential per-task requests and stops on the first failure. Partial successes stay saved. A lost response can follow a committed deadline change; Check deadline results uses GET for the exact attempted request. It does not repeat the change or continue unattempted tasks. Checking remains possible after the chosen deadline passes.

After partial success, clear the batch and select only tasks still needing a change. Tasks already due at the chosen instant reject a new review. Target edits invalidate an earlier review. Clearing or leaving the inbox loses the browser's unfinished target/review/request-check state; it does not undo saved work.

To remove malfunctioning controls, revert their application commit and deploy through the normal release gate:

```sh
git revert --no-commit <bulk-task-rescheduling-commit>
```

Review the diff, run the configured checks, then commit and deploy. The existing single-task rescheduling and bulk completion controls remain available. Before shipping, prove the code inverse reconstructs the exact baseline tree and reapplication reconstructs the feature tree. No compatibility patch or database rollback is needed.

A code revert preserves legitimate task deadlines, activities and audit receipts. Inspect disputed changes individually in CRM and choose an appropriate deadline. Never automatically restore a whole batch's old dates, delete history, restore the full database, edit applied migrations, weaken access/review checks, or force-push. Recovery takes a normal code deployment.

The disposable PostgreSQL drill verifies10 task deadline changes,10 activities and10 audit receipts, exact Asia/Manila conversion and old/new dates, duplicate replay/concurrent idempotency, partial failure, GET-only checking, completed/reassigned/foreign denial, manager scope, tampered target rejection, elapsed-deadline checks, and compatibility with the unchanged baseline reader. Source records, unrelated records, callback appointment state and callback outcome history remain unchanged. All data is synthetic. Production verification uses anonymous reads and read-only widget/migration aggregates.

Keep the widget off. Do not contact AI/email providers during diagnosis. Per-task custom targets in one batch, cross-device unfinished reviews, atomic batches, automatic retries/date rollback, callback calendar changes, live providers and production-volume throughput are outside this release.
