# Recover Approved inbox task history

1. If task history cannot load, close the reader or use **Refresh task activity**. Failed reads are not retried automatically on focus.
2. If the new reader causes a release issue, revert the task-history feature commit and deploy through the existing CI pipeline.
3. Verify the recovery commit through `/release.json`. Confirm anonymous APIs still deny access and the widget remains disabled.

This feature performs reads only. It adds no migrations, dependencies, stored settings, provider calls, or mutation paths. Reverting the code restores the previous completion/rescheduling helper without changing its write permissions or task records.

The timeline shows structured inbox task receipts for the currently authorized linked task. Actor display names, audit recording times, and stored UTC deadlines are projected into the response. Free-text notes, raw audit JSON, personal snoozes, and unsupported CRM history are not reconstructed.

Do not delete audit entries, modify task deadlines, restore a database backup, or reopen completed tasks to undo a display issue. Authenticated production task changes and provider/email operations are excluded from release verification.
