# Recover follow-up snoozing

Use this procedure if personal snooze changes need to pause. Existing snoozes, due reminders, read receipts, task due dates and callback deadlines remain intact. This feature makes no provider calls and has no background sender.

## Pause changes

Apply `docs/recovery/pause-follow-up-snooze.patch`, run the configured checks, and release through the normal migration and deployment gates. The policy rejects both snooze and wake requests with HTTP 503 before a database write. Listing, Pending/Snoozed filters and due reminder reads continue to work.

Keep migration `20261105080000_add_follow_up_snoozes` and its table/indexes. Do not drop data or roll back to application code that ignores future snoozes: that could show intentionally hidden reviews early. The migration is additive, transactional, contains no backfill, and revokes browser-role table privileges even when default privileges grant them.

Before release, verify the pause patch applies and reverses cleanly. A synthetic pause check must prove both mutation actions reject before database or network access. Restore the original policy after that local check.

## Resume changes

Reverse the pause patch, run the configured checks, and release normally. No data repair is needed. Existing due reminders use the original user/workspace and snooze revision; previously read revisions stay acknowledged.

## Verify after release

Use read-only checks for the exact release SHA, successful CI/deployment gates, migration presence, row-level security, absence of browser-role table privileges, valid composite foreign keys and indexes, and anonymous API rejection. Verify the receptionist widget remains disabled. Never create real leads, send emails, or invoke an AI provider to verify this feature.

## Behavior limits

Reminders appear in Flowrish when the user loads or refreshes the inbox; visible pages check every minute. There are no email, browser-push or closed-app notifications. Snoozes belong to one user and workspace. Reassigned callbacks use the new owner's own snooze, if any. Reviewed items, completed tasks and inaccessible or merged leads do not become due reminders.

The browser supplies its IANA timezone for tomorrow at 9 AM or a custom minute. The server resolves it against the database clock, rejects missing/repeated daylight-saving minutes and enforces a future time within 365 days. This does not reserve a callback appointment or change business hours. After an uncertain mutation response, refresh before making another change; the browser never retries it automatically.

## Recorded release baseline

This migration adds only the private snooze table and a parent unique index; it does not update existing business data.

The tested local pause rejects both mutation actions before database or network access and restores the policy file exactly afterward. If saves fail or controls cannot confirm their result, apply the pause through one normal release and verify the deployed SHA. Retain reminder data and filtering while investigating. Do not restore a whole database snapshot, edit an applied migration, or rewrite main history to undo this feature.
