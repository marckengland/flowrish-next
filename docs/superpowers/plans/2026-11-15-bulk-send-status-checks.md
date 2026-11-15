# Bulk send-status checks implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Review selected email follow-ups and check saved send statuses in a bounded, read-only queue without disturbing drafts or blocked retries.

**Architecture:** Add one action to the existing Bulk actions menu. A separate selection/review/results component uses the current scoped GET send-result endpoint, sequentially, with at most 20 targets and a 15-second timeout per read. Store only scalar status metadata. Retain reviewed/results rows through list refreshes, and update card badges independently of composer permission.

**Tech stack:** Existing React/Next, Zod, Vitest, Playwright. No dependency, schema, backend send or migration changes.

**Spec:** User approved the previous chat proposal: select Needs checking items, review them, show accepted/still uncertain/unavailable results, stop on connection/access changes without automatic retries, preserve drafts and blocked Send buttons. Routine choice: allow any advertised EMAIL row to be checked, including Needs checking rows, because a check is read-only and cannot unlock sends. Maximum20, sequential reads. These limits are implementation defaults.

## Constraints

- Widget off, no DeepSeek, no real emails, no new dependencies, no production business-data writes.
- Read only through the existing authenticated endpoint, with workspace/user headers, no provider calls, mutations, operation retries or draft generation.
- Strictly validate scope, canWrite, result ID and schema; do not keep provider IDs, receipts or operation IDs in batch UI state.
- Review confirmation precedes all reads. Stop at first failed/timeout read; preserve completed results and mark remaining targets not checked. Offline, actor/workspace change or revoked access cancels the current read and halts the queue; reconnect/menu switching never replays.
- Preserve exact keyed editors, pending filter edits, active reviews and uncertain results. Reading badges never alters composer retry permission. Incoming newer composer uncertainty cannot be downgraded by an old read.
- Retain all existing tests, browser scenarios and transport/write guards. Routine fixtures may change only with all behavioral assertions intact.
- Rollback: normal code revert; nothing persists, and prior send guards stay intact.

## Review focus

- Late responses after offline, unmount, identity change or cancellation cannot expose results or continue the queue.
- Access errors, malformed receipts and canWrite=false stop before another request; scope loss clears private state.
- Reviews/results survive menu/filter/list refreshes; cross-tab navigation uses the existing confirmation guard.
- Batch acceptance may update badges but cannot unlock an independently uncertain composer; stale NONE/FAILED cannot erase local uncertainty.
- No selection above20, no parallel/status-on-mount requests, no automatic replay or new outbound/provider endpoints.

## Task 1: Read-only queue and review/results UI

Files: new follow-up-bulk-send-status.tsx/tests; shared minimal reader/eligibility helper if needed.

- [x] Write RED tests for no-read selection/review, sequential scoped requests/results, maximum20, stop-on-error/timeout, offline/identity revocation/unmount and no automatic replay.
- [x] Implement the smallest controlled selection/review/results component, using existing styles and no provider or mutation path.
- [x] Run its narrow tests to GREEN.

## Task 2: Inbox retention, menu and independent badge updates

Files: bulk-actions.tsx; inbox; send-status card; focused integration/badge tests.

- [x] Write RED tests for action visibility, reviewed-row retention, exact mounted draft/blocked retry, menu preservation, cross-tab confirmation and explicit clearing.
- [x] Add independent selection/retention state, busy coordination and scalar checked-badge input. Leave send/recovery hooks untouched. Add stale-result race regressions before the fixes.
- [x] Run focused integration/card/menu tests to GREEN.

## Task 3: Browser and release verification

Files: six new guarded browser scenarios, rehearsal config and additive total280→286; plan/evidence.

- [x] Add desktop/mobile keyboard review, results plus blocked draft, stop/review-again after error, offline held response/no replay, and stale-account queue-stop scenarios. Keep every280existing scenario and guard.
- [x] Full checks with mocks/dummy env: npm test; npm run lint; npm run build; npx tsc --noEmit and npm run typecheck:fast after builds; npm run test:receptionist:mocked. Inspect screenshots and transport evidence.
- [ ] One fresh read-only whole-branch review, fix confirmed issues with regressions; merge/push under existing authorization; verify all CI, exact production SHA, anonymous API denial/private redirects and widget-off catalog. No authenticated production writes.

What this makes harder later: checked results are local snapshots. Provider reconciliation, delivery/bounce tracking, manual uncertain-send resolution and cross-device batch history remain separate work.
