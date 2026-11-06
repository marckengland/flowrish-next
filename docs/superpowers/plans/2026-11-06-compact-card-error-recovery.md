# Compact-card error recovery

Use executing-plans inline with one fresh whole-change review.

Spec: user-approved recommendation to dismiss ordinary compact-card errors without refreshing, preserving drafts, edits, active reviews and uncertain results. Finish, mock-test, fix and merge; no new dependencies, live providers, emails or widget changes.

## Task 1: Classify and dismiss safely

Write failing UI tests for ordinary draft/validation rejections, collapse after dismissal, unchanged editor nodes/values, no requests on dismissal, keyboard focus recovery, and unknown/network/write outcomes that cannot be dismissed. Add a small operation-aware classifier using actual server error contracts. Keep existing retry, access-loss and exact-result recovery behavior. Dismiss only the card-local message, and return focus to the disclosure or an available detail field.
Expected: focused regressions pass and every existing assertion remains intact.

## Task 2: Mocked browser proof

Add six guarded browser scenarios (220→226) for desktop/mobile error dismissal, draft/edit retention, mixed ordinary/uncertain errors, lost-response handling and stale access. No fixtures invoke providers or real email. Retain all existing scenarios and network/write guards.
Expected:226 passing scenarios; zero skips/retries/network violations; keyboard and narrow-screen checks pass.

## Task 3: Full verification and release

Run npm test, lint, build, mocked browser suite; strict and fast types after both builds. One fresh review and one test-first fix pass for important findings. Prove inverse/reapply in a temporary index, commit and fast-forward main, push and verify all five CI jobs, exact production alias/release, anonymous denials and widget-off state. Archive evidence and remove only owned scratch.
Expected: all checks observed passing, exact release ready and widget disabled.

## Interfaces, tradeoffs and exclusions

Classify only errors at the two card-level request boundaries. Known request rejections can clear; unknown failures, lost responses, access changes and child uncertain results retain existing protections. Dismissal is local and never retries, refreshes, generates, approves, sends or resets fields. Conservative classification makes newly introduced error codes require an explicit review before dismissal can be enabled. Stable mounted details and keys remain intact. No new API, schema, data migration, services or dependency changes; no new database drill. Live-provider/email and manual screen-reader tests are excluded; production verification remains read-only.

## Review focus

Check that dismissal classification uses actual server guarantees, unknown and malformed responses cannot be mislabeled, stale async errors cannot replace newer state, dismissal cannot erase another operation's uncertain result, no editor/composer remount or field reset, keyboard focus lands on a usable control, retention/navigation fences remain intact, and no automatic network action follows dismissal. Check every added browser scenario retains network guards.

Rollback: revert the release commit; no database or saved-record rollback. Test the inverse/reapply before release and preserve unrelated work.

Review outcome: unresolved card operations are retained independently of the latest message, so dismissing a later rejection cannot erase earlier uncertainty. Held-result retention is intentionally conservative until the user refreshes or verifies. Focus recovery prefers editable fields before action buttons.
