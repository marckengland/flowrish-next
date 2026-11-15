# Review remaining send-status checks implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Explicitly review and check only unfinished status lookups in a partial batch while keeping completed results, drafts and blocked retries intact.

**Architecture:** Extend the existing local batch component with a remaining-only review mode. A successful result, including UNKNOWN/NONE/FAILED, is a completed lookup; only unavailable/not-checked targets belong in the remaining queue. Keep the full original target/result set retained and visible, and reuse the same scoped read-only sequential queue, cancellation and authorization fences. No new endpoint, schema, dependency or persisted state.

**Spec:** User approved Review remaining status checks, preservation of completed results/drafts/blocked retries, completed/remaining progress, and no automatic resume. Existing full-review action remains available for an explicit fresh review of all selected items.

## Constraints

- Maximum20/sequential/15-second read deadline unchanged. GET saved results only; no sending, provider calls, DeepSeek, new dependencies, widget activation or production business-data writes.
- New review and cancel do no requests. Confirmation reads only the reviewed unfinished subset; successful rows and their metadata never reset during remaining review, cancel, retry, stop, timeout or transient failure.
- Remaining review cancellation returns to retained results. Repeated remaining attempts preserve cumulative progress; a successful UNKNOWN counts completed but never unlocks a composer.
- Offline/stop/access-loss behavior and scope/ID/schema validation remain. Reconnect/menu/filter refresh never starts a queue. Access loss clears private state, including completed results.
- Keep every existing assertion/scenario/write/network guard. Extend browser total286→292 additively.
- Rollback: ordinary code revert; local review state does not survive reload and no schema/data changes persist.

## Review focus

- A successful UNKNOWN/NONE/FAILED lookup cannot be accidentally requeued as unfinished.
- Only unavailable/not-checked IDs are requested; no completed callback metadata gets rewritten by remaining checks.
- Cancel/stop/failure/timeout keep completed rows and metadata and preserve progress, with no automatic continuation.
- Completed and pending IDs remain retained across menu/filter changes; unchanged keyed drafts and blocked sends survive.
- Stale scope, revoked access, lost rows and late responses retain the existing privacy/queue-stop guarantees during remaining review and running.

## Task 1: Remaining review and cumulative results

Files: existing follow-up-bulk-send-status.tsx/tests and focused inbox integration tests.

- [x] Write RED tests for subset review/confirm, no-read cancel, cumulative completion counts, successful UNKNOWN/NONE/FAILED exclusion, repeated failure, stop/offline/timeout and scope loss. Keep all existing tests intact.
- [x] Implement remaining mode and cumulative result updates, render completed results during review/running, show accurate lookup progress and hide the new action at zero remaining.
- [x] Add a real inbox regression retaining exact mounted draft and blocked retry through the subset workflow and filtered refresh. Run focused tests to GREEN.

## Task 2: Browser and release verification

Files: six new guarded browser scenarios, rehearsal config/required total and this plan.

- [x] Add desktop/mobile review/cancel/confirm subsets; exact draft + filtered-retention; repeated transient failure; offline held subset/late response; and stale-account subset stop. Keep all286 existing scenarios and guards.
- [x] Run full npm test, npm run lint, npm run build, then strict/fast type checks after both Next builds, and npm run test:receptionist:mocked. Use sanitized dummy env and guards. Inspect mobile/desktop screenshots.
- [ ] One fresh read-only whole-branch review; fix confirmed issues with RED→GREEN tests. Merge/push under existing authorization, verify all CI and exact live SHA, anonymous denial/private redirects and widget-off catalog. No authenticated production writes.

What this makes harder later: these are local saved-result snapshots. Cross-device batch history, provider delivery/bounce reconciliation and manual uncertain-send resolution remain separate work.
