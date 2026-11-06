# Compact controls above follow-up cards

Use executing-plans inline with one fresh whole-change review.

Spec: compact the empty email-match panel and put filters behind a Filters disclosure while keeping applied filters visible. Preserve filter edits, drafts, reviews and uncertain results. Finish, mock-test, fix and merge. No new dependencies, providers, real emails or widget changes.

## Task 1: Stable disclosures

Write failing UI regressions. Keep the existing filter form mounted in a hidden wrapper; use a native button with aria-expanded/controls. Keep applied summary and validation errors visible and flag unapplied changes. Toggling never applies, clears, refreshes or navigates. Keep access-loss clearing intact.

Compact EmailMatchInbox only after a successful empty read with no error, notice, preview, pending update, busy/load state or deep link. Keep its existing form subtree mounted and automatically visible for active work. Preserve the existing refresh and idempotent retry behavior.
Expected: new focused tests pass; toggles preserve nodes/values and perform zero requests/writes.

## Task 2: Existing workflows and browser proof

Adapt existing fixtures to explicitly open filters before their original filter actions/assertions, preserving all assertions and guards. Add six mocked browser scenarios226→232 covering desktop/mobile density, keyboard, pending filter edits, applied summaries, drafts, match review uncertainty and privacy.
Expected:232 passing scenarios, empty guard log, screenshots inspected on desktop/mobile.

## Task 3: Verify and release

Run npm test, lint, build, guarded browser suite; strict/fast types after both builds. Fresh whole-change review; one test-first fix pass for important findings. Prove staged inverse/reapply in temporary Git index. Commit, fast-forward main and push; verify five CI jobs, exact production alias/release, anonymous denials and widget off. Archive owned evidence and remove only this plan's scratch.
Expected: all checks observed passing, exact deployment ready, zero enabled widgets.

## Interfaces, tradeoffs and exclusions

Stable wrappers consume existing filterDraft/filters and email loading/review/pending state. Mounted hidden DOM costs some memory and makes future list virtualization harder, but avoids resetting edits or request ownership. A successful-empty check is deliberately required before compaction; failures must not look like an empty mailbox. No new server/API/schema/dependency changes. No live-provider/email, manual screen-reader or new database fault drill; production observations read-only. Preserve unrelated working-tree files.

## Review focus

Inspect disclosure mount/key stability, filter draft/applied distinctions, summary completeness including due/progress/order, errors and deep-linked match reviews staying visible, lost confirmation and busy ownership, no automatic requests from toggles, scope/revocation privacy and keyboard/DOM identity. Confirm old workflow assertions and all network guards remain.

Rollback: code-only revert, no saved-record rollback; prove inverse/reapply before release and preserve all tasks, reminder and history records.
