# Follow-up inbox

Open **Follow-ups** in the sidebar to review incoming replies and captured receptionist callbacks. Each card includes its source preview and a proposed task. Edit the task before approving, or dismiss it. Approved and dismissed items remain in history.

Approval creates a task once. A receptionist callback already has a task from the caller's confirmed request; approval keeps that task rather than creating another one. A draft email opens the existing composer for review. Sending requires its separate Send action and a connected mailbox.

Reply detection runs during Gmail or Microsoft mailbox sync. A qualifying inbound reply stops the matching active cadence. Outbound messages, automatic replies, delivery failures, and mail that cannot be linked safely to a lead/thread must not stop a cadence. Source cards show message previews. Choose Generate contextual draft to retrieve the full source conversation and draft a reply using the configured AI provider; see [conversation drafts](CONVERSATION_DRAFTS.md). Manual templates remain available, and generation never sends email.

Inbox access requires lead read permission. Approval and dismissal require lead write permission. Items are scoped to the signed-in organization and assignee. The public receptionist has no access to this inbox.

## Verification

Follow the [testing guide](TESTING.md), including the isolated browser rehearsal and synthetic database checks. Run type checks after the builds. Keep execution evidence private.

## Rollback

The base commit is `37ef0719334d09ac50a00da995f784e43cc301f5`. The migration adds server-only inbox storage and message identity metadata. It does not delete customer data or change provider credentials. Revert the feature merge and redeploy the previous application while retaining additive schema and inbox history. Never drop inbox tables, edit an applied migration, restore the whole database, or rewrite main history to undo this feature.

Reverting code does not undo tasks that users approved or emails they explicitly sent. Review a specific task in the application if it was created in error. Cadence exits already recorded also persist; do not automatically reactivate sequences after a rollback.

Mailbox detection runs during automatic or manual sync. Automatic checks run every five minutes when Inngest is configured and registered; the Mailbox sync panel shows health and last success. Providers are paginated from the previous successful checkpoint with overlap; the first sync covers the past day. See [automatic mailbox sync](AUTOMATIC_MAILBOX_SYNC.md). A send already handed to the email provider cannot be recalled when a reply arrives.

Repeat cadence history also needs a forward migration: keep uniqueness for live ACTIVE/PAUSED enrollments while allowing multiple completed/exited attempts. This prevents a new reply from failing to stop a re-enrolled lead merely because an earlier attempt already exited. This index change retains all enrollment rows.

Keep the partial live-enrollment index on rollback. Recreating the old full-status unique index can fail once multiple historical exits exist; reverting application code does not require restoring that index.

Rollback verification: the staged feature tree was exported to a disposable archive, its full reverse patch applied, and every tracked file hash matched the base commit exactly. Retain the additive schema/indexes when reverting code.
