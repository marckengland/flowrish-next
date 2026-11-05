# Review email alerts

Open **Notifications → Email alerts** to see pending email work from your own connected mailboxes in the current business. The bell combines your unread callback and email counts. Callback and email lists keep separate filters and pages.

Email alerts cover two kinds of work:

- **Email match needs review:** a synced address has a pending routing decision. Follow **Review email match**, inspect the current candidates, and explicitly confirm a link or dismiss the match.
- **Email reply needs review:** a routed cadence reply has a pending email follow-up. Follow **Review email reply** to open that follow-up, including one outside the first inbox page.

Opening an alert does not mark it read, resolve a match, approve a task, generate a draft, or send an email. Read-only users can inspect permitted work and acknowledge their own alerts. Reviewing business work still requires its existing permissions and sending approval.

## Acknowledge and refresh

**Mark email alert read** stores a personal read receipt. It does not complete the work. Repeating that action after a lost response returns the original timestamp without creating another receipt. Use **All current alerts** to include acknowledged work that still needs review.

Resolved or inaccessible work disappears when the list or count refreshes, even if its old receipt remains stored. The bell and email list refresh every minute while visible; **Refresh email alerts** updates immediately. Switching workspaces or encountering changed account access clears cached rows. A count failure is shown as unavailable, not zero.

An alert's key depends on its source identity and type. Sync retries and normal lead edits do not create duplicates. Resolving an address conflict can reveal a separate pending reply alert if the linked reply still requires follow-up review.

**Waiting** measures time since the message was stored for a match or the follow-up was created for a reply. The full timestamp uses the browser's local timezone. It is not a promised response deadline.

## Privacy and limits

Every count, list, acknowledgment, and focused reply read checks the current organization member, mailbox ownership, stored mailbox identity, and applicable lead access. Reply alerts additionally require an owned pending email suggestion with the exact source message, thread, and activity association. Ordinary personal email without a pending follow-up does not generate a reply alert.

Notifications copy no message subject, body, or lead name. A private `EmailNotificationRead` table stores only workspace, user, hashed key, and read time. Offboarding removes that member's receipts. Existing pending work can appear immediately; answered historical email is not backfilled.

Lists show 20 rows per page. This release adds no email, push, or SMS notifications, persistent escalation schedule, new dependency, or AI-provider call. The callback and email lists are not one mixed timeline. See [recovery](recovery/email-notifications.md) for a code rollback that retains the additive schema.
