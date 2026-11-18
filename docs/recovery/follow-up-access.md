# Pause follow-up writes without removing access checks

Use this recovery when follow-up reviews, draft generation, or manual email delivery fail after the access update. Do not redeploy the older unrestricted implementation.

## Migration compatibility

This change adds no migration or data backfill. Do not undo access checks to recover availability. Existing pending work can stay in place.

## Apply the pause

From the release checkout:

```sh
git apply --check docs/recovery/pause-follow-up-access.patch
git apply docs/recovery/pause-follow-up-access.patch
```

Review the single change: `followUpWritesEnabled()` returns `false`. Run the repository checks, commit the pause, and deploy through the normal reviewed release process. No database migration, secret change, dependency change, or data deletion is needed.

The pause blocks new approvals, dismissals, contextual draft generation, template preparation, and manual API delivery with `FOLLOW_UP_PAUSED` (503). Inbox reads retain current membership and lead filtering. Callback review materialization can still maintain pending inbox records. Background cadence senders retain their existing behavior; this switch is not an organization-wide email stop.

An email already accepted by Gmail or Microsoft cannot be recalled by this patch. Check the sending mailbox before retrying an uncertain send. Do not retry automatically or delete pending suggestions to clear an error.

## Resume

Fix the underlying problem and verify it with mocked providers. Reverse only this patch, review, run checks, and deploy normally:

```sh
git apply --reverse --check docs/recovery/pause-follow-up-access.patch
git apply --reverse docs/recovery/pause-follow-up-access.patch
```

Keep the expected-user headers, current permission checks, lead filters, source binding, and private response headers in place.

## Verification evidence

The patch was applied to the implementation and its reverse applicability checked locally. A network-blocked synthetic harness called seven service boundaries: review, generation, generated-send preparation, template preparation, final generated-recipient validation, manual authorization, and manual delivery. All returned the paused error before database writes or network calls. The manual delivery path performed one synthetic lead read. The enabled policy was restored byte for byte afterward.

This proves the local pause guard. It does not measure deployment time, recall accepted messages, test real providers, or change production data. Release verification remains required before shipping the implementation or a recovery build.

Run the full repository checks and disposable PostgreSQL regressions for stale responses after denial, retained authorized drafts, eligibility behind inaccessible rows, consistent lead-lock ordering, callback handoff, and rollback. Use synthetic fixtures for mutation tests. Release verification should use anonymous read-only requests and catalog aggregates; keep execution evidence privately.
