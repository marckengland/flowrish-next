# Recover Approved inbox task completion

Use this procedure if task completion reviews or receipts fail after deployment.

1. Record the failing follow-up ID and request ID through the normal authorized support process. Keep task content and credentials out of logs.
2. Use **Check completion result** after an uncertain response. This reads the exact request and never repeats completion. Filtered background refreshes retain unresolved requests. Leaving the view requires confirmation.
3. To remove the new controls and endpoint, revert the task-completion feature commit on main and deploy through the existing CI pipeline.
4. Confirm `/release.json` identifies the recovery commit. Confirm private APIs deny anonymous access and the widget remains disabled.
5. Open the linked task in CRM to inspect its current state. Do not automatically reopen completed tasks or remove their activities.

This release adds no migrations, provider configuration, saved-view fields, or dependencies. Completed tasks use the existing `isComplete` and `completedAt` fields. Activity notes use the existing `Task completed: {title}` format. Audit proof is additional JSON that earlier readers ignore. Reverting the application code preserves confirmed CRM work.

Code rollback does not undo a completion a user already confirmed. If a completion was a mistake, review that task through the normal CRM correction process. Do not restore the whole database, delete audit entries, rewrite deployment history, or run a broad task update.

Before release, the disposable PostgreSQL drill checks identical and distinct concurrent requests, two tasks on one lead, stale reviews, access loss, and transaction rollback after failed activity or audit writes. It also checks that the unchanged CRM reader understands completed tasks and that unsent drafts remain stored.

Authenticated production completion is not part of release verification. Use mocked browser requests and disposable synthetic records for workflow tests. Production checks use anonymous GET requests and read-only aggregate configuration checks.
