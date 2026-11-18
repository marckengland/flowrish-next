# Recover merge-aware email routing

Use this procedure if email matching creates unexpected associations, stops the wrong cadences, or repeatedly fails sync pages. Preserve the message IDs and audit entries while investigating. Do not send a test email or use an AI provider to diagnose matching.

## Migration compatibility

Migration `20261105030000_add_email_match_review` enables EmailMessage RLS on fresh installs and adds one nullable JSONB column, a size/state constraint, and a partial pending-review index. It does not update existing rows, add grants, or add policies. The synthetic drill injects a migration failure to verify transaction rollback before applying all 38 migrations.

## Pause new routing

The tested [pause patch](pause-merge-aware-replies.patch) changes `emailRoutingEnabled()` to return false and adds an actual-disabled-policy regression. Apply it on a recovery branch with `git apply --check docs/recovery/pause-merge-aware-replies.patch`, then `git apply docs/recovery/pause-merge-aware-replies.patch`. Review and merge that branch through the normal deployment process. Allow a build and deployment cycle; the time depends on CI availability. Confirm the disabled-policy tests and exact deployed release SHA before declaring routing paused. The patch was applied to a disposable source export and its 12 focused tests passed, including denial before database access and the held-routing/no-effects case. Its full 2,182-test suite and lint also passed. Reversing the patch restored the exact enabled policy; reapplying it remained valid. The export was removed afterward.

When disabled, new matching messages are retained as pending with reason `PAUSED`. The review resolution endpoint returns 503 before database effects. Existing stored decisions and receipts remain intact. Reads and previews remain available. No schema rollback is required. Repeating the code deployment does not rewrite stored decisions.

When re-enabled, pending messages require review; they are not silently reprocessed by sync. Unmatched mail remains unmatched. Do not delete routing metadata to force a retry.

## Correct an existing association

Pausing prevents new effects; it does not reverse an already committed activity link, cadence exit, pending suggestion, user-approved task, or sent email. A broad automatic undo would be unsafe after subsequent edits.

For an individual correction, an administrator must inspect the exact EmailMessage, its linked Activity, routing receipt, EmailMessage/CadenceEnrollment audits, and affected suggestion and enrollment IDs. Prepare a separately reviewed transaction with current-value checks for those exact rows. Verify it on synthetic data before applying it. Re-enrolling a cadence can send email later and needs explicit approval. A sent email cannot be recalled by this feature.

Keep the additive schema and audits. Do not edit the applied migration, drop the column, clear a mailbox checkpoint, restore a whole production snapshot, force-push main, or run `prisma db push` from this checkout. Those actions can lose evidence or repeat unrelated work.

## Verification requirements

Use disposable PostgreSQL and synthetic browser fixtures to verify failed-DDL rollback, private schema constraints, merged-target routing, ambiguity holds, mailbox-owner isolation, confirmation replay, stale versions, current permissions, and transaction rollback after a failed audit. Test the actual draft preparation/send service with a mocked transport to confirm archived recipients remain bound and that changed recipients or versions are rejected. Run the full repository checks and keep execution records privately.
