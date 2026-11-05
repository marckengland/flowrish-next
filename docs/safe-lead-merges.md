# Review and merge duplicate leads

Open a lead and select **Check for duplicates**. Matches use permitted records in the current business. A matching company name alone does not prove two records describe the same prospect.

1. Choose a possible duplicate and select the **Lead to keep**.
2. Select **Preview merge**. Compare the retained and archived field values, transfer counts, and any blockers.
3. Check **I reviewed the retained fields, transfers, and archived record** and select **Confirm merge**.

The retained lead keeps its fields, including its owner, stage, score, status, and email address. Its update timestamp advances. The secondary lead is archived with its original fields; it is not permanently deleted. Activities, tasks, stage history, and score history move to the retained lead. Missing contact links are added without duplicating existing links, and the original archive contact links remain. Email-message and attachment identities stay attached to the transferred activities.

Linked conversations remain visible in the retained lead’s Emails tab even when its address differs or is missing. A transferred thread that does not involve the retained address has no Reply control. Merging sends no emails, executes no cadence steps, and creates no callbacks. Existing linked conversations are transferred as history; this release does not register the archived address as an inbox alias or change future email-matching rules. Choose the retained email accordingly.

## Blocked merges

Both records must be active and accessible in the same business. Confirmation requires `leads:read`, `leads:write`, and `leads:delete`; users with only read permission can inspect permitted matches.

This version blocks a secondary lead with cadence enrollments, follow-up suggestions, receptionist call records, callback/waitlist CRM handoffs, or earlier merged records. These links need a separate lifecycle migration. Keeping the workflow-linked record instead can allow a safe merge when the other record has no blockers. The preview lists the reason before confirmation.

Reviews are limited to 500 combined linked rows, including projected new contact links. Duplicate search shows up to 50 permitted matches. Larger merges need administrator review.

## Changed records and uncertain results

A preview expires after 10 minutes. The server checks the records, related rows, current access, and expiration again after lock waits. Any mismatch rejects the entire merge and requires a fresh review. Changing the candidate or retained lead cancels the unconfirmed review.

If the confirmation response is lost, select **Retry confirmed merge**. The same review ID retrieves the original result without transferring records again. New merges are disabled while that request is uncertain. Reloading closes this browser’s retry control; inspect the lead’s audit history before preparing another review.

Each account/business can hold 20 pending reviews. Creating a preview removes that actor’s expired pending reviews. Applied receipts and repair manifests remain with business audit history and survive staff offboarding. Current membership and merge permissions are still required for every operation. An administrator-undone merge cannot be reapplied through its old review.

Deferred: field-by-field value selection, workflow migration, bulk merges, automatic merging, and an undo button. The operator recovery procedure is documented in [merge recovery](recovery/safe-lead-merges.md).
