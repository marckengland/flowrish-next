# Send-status freshness implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Show when saved send status was explicitly checked, flag older snapshots, and preserve completed results, drafts and blocked retries through rechecks.

**Architecture:** Add client-only checked-at timestamps separate from send metadata.updatedAt. Reuse GET send-result and existing individual/batch review and queue fences. Preserve each previous completed snapshot while a new lookup is running, unavailable, interrupted or cancelled. No endpoint/schema/dependency changes.

**Spec:** User approved last-check display, older-result cue, explicit rechecks, retained work and no automatic checks/send retries. Builder choice: five-minute older threshold, one-minute display updates, local open-inbox snapshots only. Native React/Date and existing styling. The standard distinction is observation time versus record-update time; never infer the former from the latter. Persisted cross-device check history would require wider storage work; keep this change local.

## Constraints and review focus

- Widget off, no DeepSeek or real email/provider calls, no dependencies or authenticated production business-data writes.
- Freshness is informational and cannot grant send/retry permission. Initial list data is not an explicit lookup. Time passing, focus, reconnect and ordinary list refresh never initiate status GETs.
- Five minutes including boundary is older; invalid/future clocks are not labelled fresh. Successful no-attempt and UNKNOWN/FAILED lookups still get checked-at.
- Failed/offline/stopped/timed-out/late rechecks keep prior snapshot/timestamp. New composer signals cannot inherit old freshness. Verified accepted statuses never downgrade.
- Remaining-only batch checks preserve excluded timestamps; full rechecks retain completed result display through running/failure/cancel. Scope/access loss still clears private snapshots.
- Keep all existing assertions/scenarios/guards. Add six mocked browser scenarios292→298. Strict checks follow both Next builds.

## Task 1: Freshness display and safe explicit rechecks

Files: new send-status-freshness.tsx/tests; existing card, bulk checker and inbox/tests.

- [x] Add RED tests for unchecked initial/list metadata; exact successful check time; five-minute aging without requests; failed/offline/late receipts retaining timestamps; composer-signal invalidation; batch/cumulative/full-recheck retention and scope loss.
- [x] Implement minimal shared freshness display, optional card batch timestamp prop, local bulk snapshot timestamps/previous-result retention, and parent timestamp handoff while leaving metadata callbacks/API unchanged.
- [x] Run focused card/bulk/inbox/freshness tests to GREEN. Keep mounted Subject node, original recovery uncertainty and disabled Send across explicit rechecks and filter/menu changes.

## Task 2: Browser and release verification

Files: new send-status-freshness.spec.ts, rehearsal config/count and this plan.

- [x] Add six guarded browser scenarios: desktop/mobile aging and explicit read, failed recheck retention, held/offline read with no replay, full-batch completed snapshot retention, and filtered exact draft/blocked retry preservation.
- [x] Run full npm test, lint, build, then strict/fast types, and mocked browser rehearsal with sanitized dummy env and socket/private-env guards. Inspect desktop/mobile screenshots.
- [ ] Fresh whole-branch review and one TDD fix pass if needed. Verify code rollback, commit/FF merge/push under session authorization; verify CI, exact deployed SHA, anonymous denial/private redirects/widget-off catalog.

What this makes harder later: cross-device check history and provider delivery reconciliation remain separate work. No live authenticated workflow or provider test is authorized.
