# Recover Approved inbox task rescheduling

1. For an uncertain response, use **Check rescheduling result**. This reads the exact request without repeating the deadline change. Filtered refreshes retain the card until the check resolves or you explicitly leave.
2. If the new workflow fails after deployment, revert the rescheduling feature commit and deploy through the existing CI pipeline.
3. Verify the recovery commit through `/release.json`. Check anonymous API denial and confirm the widget stays disabled.
4. Inspect affected tasks through CRM. Use the recorded NOTE activity to review previous and new UTC deadlines before making an authorized correction.

This release adds no migrations, dependencies, provider settings, or saved-view fields. Rescheduling updates the existing task `dueDate`, a standard NOTE activity, the lead activity time, and a private audit receipt. The baseline CRM reader understands these records. Reverting the application preserves confirmed deadline changes.

Do not restore the entire database, reopen completed tasks, delete audit entries, or apply a broad deadline update to undo this feature. Correct an individual deadline only after reviewing its activity and current state.

Local verification uses mocked transport and a disposable PostgreSQL database with the baseline migrations. It covers identical and distinct concurrent requests, completion versus rescheduling, stale task versions, timezone conversion, final access loss, and rollback after activity or audit failures. No authenticated production task mutation, provider request, email delivery, or widget activation is part of release verification.
