# Use the follow-up Bulk actions menu

Choose an action below the status tabs. Pending follow-ups offer snooze and task approval when the loaded selection supports them. Approved open tasks offer completion and deadline rescheduling. Read-only users do not receive bulk editing controls.

Selecting an action only changes the visible editor. It does not fetch previews, change tasks, send email, or clear drafts. Idle editors are hidden; edited deadlines, approval reviews, snooze work and uncertain results remain visible after switching the menu. An edited snooze target also remains available if background refresh removes every eligible row. Existing confirmation and exact-request checks still apply.

Approval and snooze share their selection. Clearing that selection clears its local reviews. **Clear snooze work** clears only the reminder editor and results; it preserves the shared selection and approval edits. Completion and rescheduling retain their separate clear/cancel controls. Leaving active work requires an explicit discard confirmation. Loss of access clears private controls and details.

The menu is a native select with existing focus styles and mobile sizing. It is disabled while bulk requests run. A selected or retained action can remain visible after its tasks change so its results can be checked or cleared; existing task eligibility/version checks prevent stale confirmation.

## Rollback and verification

Revert the application commit and redeploy. There are no schema, dependency or service changes. Preserve tasks, reminder changes, batches and audit receipts already confirmed by users; an application rollback does not undo them.

Run the repository's full tests, lint, build, strict/fast type checks after Next builds, and mocked receptionist rehearsal. The rehearsal keeps the prior 208 scenarios and adds six menu cases. Do not verify by calling AI, sending real email, enabling the public widget, or changing production tasks. No new database drill is required for this presentation-only change.
