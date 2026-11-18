# Recover follow-up activity history

This feature reads existing audit entries; it adds no tables, audit writes, scheduled jobs or provider calls. If viewing activity fails or shows an incorrect state, revert the follow-up history feature commit and release normally. Existing approvals, snoozes, reminders and audit records remain intact. No data repair or database restore is required.

After a release or revert, verify its exact SHA, successful CI/deployment gates, anonymous history-API denial and the widget remaining disabled. Do not create production records, send email or invoke an AI provider for verification. Do not restore a whole database snapshot or edit applied migrations to undo a read-only feature.

History displays only your recognized approval, dismissal, snooze and wake records for a currently accessible follow-up. Other users' personal actions and unsupported legacy payloads are omitted. A due explanation is computed from the current snooze and database clock; it is not a fabricated historical event. Page navigation scans existing audit records, so a page of unsupported legacy entries can be empty while older pages remain available. Team-wide history and exports are outside this release.
