# Recover saved bulk-action history

Saved history covers reviewed bulk task completion and deadline rescheduling confirmed after this release. Open **Follow-ups → Saved bulk-action history** in the same account and workspace. Choose a batch, then **Check saved results**. This only reads requests; it cannot resume a batch or repeat a task change.

A confirmed result requires an exact audit receipt. Later task edits appear separately as **Changed since this action**. Failed requests and requests that never started are distinct. An uncertain request may still finish: an absent receipt does not prove no change occurred. Refresh history and inspect the task before making a fresh review. Tasks outside current permissions show no identifying details.

## Review remaining tasks

Choose failed or unattempted open tasks, then select **Review remaining tasks**. Rescheduling requires a new future deadline and timezone. Review the current task details before confirming. This saves a separate batch with new request IDs; the original record remains unchanged. No task changes occur before confirmation.

Successful, completed, inaccessible and still-uncertain tasks are excluded. **Check saved results** can resolve an uncertain attempt if its exact receipt appears. A missing receipt leaves the attempt uncertain, because the original request may still finish. Do not repeat it based only on an absent receipt.

Selection and review keep the inbox's filters and unsent drafts. While confirmation runs, competing inbox actions are disabled. A lost saving acknowledgment starts no task requests. A lost task receipt stops the queue; **Check remaining results** only reads the exact attempted request and never submits the rest.

## If saving fails

The browser must receive the exact saved-intent acknowledgment before sending any task changes. A lost acknowledgment starts no task requests from that browser. The saved batch can still appear with unattempted entries. Clear the current selection and make a fresh review when ready; history never continues it automatically.

## Application rollback

Revert the application feature commit and redeploy through the normal release process. Keep migration `20261106010000_add_follow_up_task_batches` and its table. Do not drop or edit production history or audit receipts. The previous application ignores the additive table, and existing single-task routes remain compatible. Stop a problematic batch by closing its tab; already-started requests can still finish. Preserve request records for read-only investigation.

The migration is atomic and enables RLS while revoking all browser-role privileges. The server scopes every lookup to current membership, user, workspace, lead access and task access. Membership deletion cascades that member's private batch records. No automatic cleanup or retention policy is introduced.

## Verification

Use the repository's mocked browser rehearsal and disposable PostgreSQL drill. Never use production tasks as test fixtures. Verify exact release metadata, CI's migration job, table RLS/privileges, and the public widget's disabled state with read-only checks. Live AI, email transports, retrospective grouping, and durable pre-confirmation reviews are outside this verification.

Inspection links in saved history open new tabs to preserve the current inbox's unsent edits. This change does not alter existing navigation links elsewhere in the inbox.

To roll back the remaining-task review feature, revert its application commit and redeploy. No schema reversal is needed. Keep any newly confirmed tasks, batches, activities and audit receipts; an application rollback does not undo a person's confirmed task changes.
