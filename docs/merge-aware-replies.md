# Match replies after a lead merge

Future synced messages can match an archived lead's email or alternate email to its active retained lead in the same business. Several archived records pointing to the same retained lead count as one match. Soft-deleted records without a merge destination do not count.

A unique match links the stored message to the retained lead. A human reply stops only active or paused cadence enrollments for that mailbox owner, lead, and enrolled conversation, after enrollment. Automated messages, outgoing mail, and unrelated threads do not stop cadences. Any resulting follow-up starts as **Pending**. Matching does not call AI, generate a contextual draft, create a task, or send email.

## Review conflicting addresses

Open **Follow-ups → Email matches to review**. This list contains pending messages from your own connected mailboxes in the current business.

1. Select **Review match** and read the message preview.
2. Choose an accessible retained lead. Nothing is selected automatically.
3. Acknowledge the effect on cadences, then select **Confirm email match**. Alternatively, acknowledge and select **Dismiss match review** to remove the pending review without linking it.

The server checks mailbox ownership, current permissions, lead access, message identity, candidate versions, and existing associations again after lock waits. Changed reviews require a fresh preview. Linking cannot move an activity already attached to another lead. Inaccessible matches are not named. An invalid merge destination or more than 200 matching source records blocks linking; an administrator must investigate.

If the response is lost, use **Retry confirmed update**. It resubmits the same confirmation and retrieves its receipt without repeating activity creation or cadence stops. Other updates stay disabled while the result is uncertain. Reloading loses the browser's retry control; inspect the message's audit history before starting another review.

The list shows up to 100 recent pending messages, and previews show up to 20 permitted candidates. Read-only users can inspect their own messages but cannot confirm or dismiss them. Workspace changes or revoked access clear private review data.

## Drafts and message history

Stored message and attachment identities stay intact. Contextual follow-up drafts can use a merged address only when the stored routing decision, current mailbox owner, linked activity, and current merge lineage all verify that exact source sender. The full-conversation reader still verifies recipients and thread identity. Draft generation and sending remain separate user actions, with the existing draft version and conversation checks before sending.

A merge does not change the retained lead's email fields or configure an email-provider alias. General composing, forwarding, and the historical Emails-tab Reply controls keep their existing address rules.

## Limits and recovery

Processed decisions are sticky. Sync replay does not reinterpret a previously routed, unmatched, pending, or dismissed message. Existing messages encountered by normal checkpoint/overlap sync can receive their first decision; there is no bulk historical backfill. Outgoing messages with several external recipients are left unmatched.

Conflicts delay cadence stopping until reviewed. A match is a point-in-time decision; a later-created duplicate does not retroactively move mail. Alias groups with invalid destinations, large groups, and corrections to existing activity associations require administrator work.

The additive `EmailMessage.leadRouting` column stores decisions and confirmation receipts separately from provider metadata. It has a JSON shape/size constraint and a pending-review index. It adds no browser access policies. See [recovery](recovery/merge-aware-replies.md) before disabling routing or correcting a committed association.
