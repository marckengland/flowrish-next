# Recover bulk follow-up approval

Baseline application: `1c1c8cd2e63c03c71d212e3486f016beb84286cc`.

This release adds no dependencies or migrations. It reuses the existing approval transaction and audit table. A bulk confirmation is a sequence of individually reviewed approvals, with a unique request ID and source/task fingerprint for each. Processing stops at the first failure. A read-only receipt check does not repeat approval.

If the controls or new endpoint fail, revert the bulk-approval application commit and deploy through the normal release gate. The previous application can use tasks and audit records already created. Recovery takes a normal application deployment. It does not undo tasks a user deliberately approved or restore their former Pending state.

For an urgent pause while preparing recovery, use the existing follow-up write policy documented in `docs/recovery/follow-up-access.md`; review its effects on single-item approval and manual email before deploying the pause. Receipt reads remain subject to current permissions.

Before shipping, check that the full inverse applies cleanly in a temporary Git index and reproduces the baseline tree. In disposable PostgreSQL, verify exact-request replay, concurrent approval, callback deadline protection, rollback on an audit failure, stale source/ownership/permission rejection, legacy single-item approval and unchanged source/draft fields. Verify that the task count equals only the deliberately confirmed synthetic approvals.

Do not delete approved tasks or audit receipts, bulk-reset statuses, restore a production database, weaken account/workspace checks, enable the widget, or use a provider/email send to diagnose this feature. Use a fresh review for unattempted items after a partial batch.
