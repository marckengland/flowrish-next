# Compact follow-up cards

Use executing-plans inline; one fresh whole-change review at the end.

Goal/spec: implement the user-approved summary-first cards. Show lead, source preview, title and task progress first. Expand editing, snooze, histories and drafting tools on demand. Preserve mounted drafts, edits, active reviews and uncertain results. Mocks only; no dependencies, live providers, emails, widget changes or production test writes.

## Task 1: Stable disclosure and retained work
Write failing card tests. Add an accessible disclosure with stable mounted details, compact preview and task summary. Keep quick draft/open-task actions. Edited fields, open drafts, busy operations, active task reviews and unresolved results hold details open; explicit cancel/reset unlocks collapse. Add optional child retention reporting without changing request contracts. Preserve current access-loss clearing.
Expected: narrow tests pass; toggling makes zero requests and preserves nodes.

## Task 2: Workflow and browser verification
Adapt existing workflow fixtures to explicitly expand cards before detail actions without dropping assertions. Add six guarded browser scenarios, 214 to 220, covering desktop/mobile, keyboard, draft/edit retention, unresolved result and read-only/access loss. Capture screenshots.
Expected: all existing and new scenarios pass; empty network violation log.

## Task 3: Verify and release
Run npm test, lint, build, mocked browser suite, then strict and fast types after both builds. Fresh whole-change review; one test-first fix pass for important findings. Prove staged inverse/reapply with temporary Git index. Commit, fast-forward main, push and verify all five CI jobs, exact production release and anonymous privacy/widget checks. Archive this plan's evidence and remove only its scratch workspace.
Expected: all checks observed passing, exact release ready, widget off.

## Interfaces and tradeoffs
Disclosure consumes local editor state and additive completion/snooze work callbacks; rescheduling already reports holds. Stable mounted wrappers preserve state but retain more hidden DOM. This makes virtualizing cards harder later. No backend, schema, dependency or API changes; no new database drill required. No live-provider, email, manual screen-reader or production authenticated-write tests.

## Review focus
Check that hidden forms remain mounted; keyboard disclosure semantics; edits, active reviews and uncertain receipts cannot be hidden; pending reads/writes cannot be repeated by toggling; child busy ownership and callback identity; filters/pagination retention; permission loss clears private content; summary text and dates on mobile; no provider calls from expanding.

## Verification and rollback

The single fresh review identified pending clean operations missing from parent retention. Delayed-response regressions now cover retention and blocked discard during generation/approval. Ordinary card-level errors remain expanded until retry or inbox refresh (deferred usability issue). No API, schema, dependency, email or widget settings change.

Antidote: revert this release commit; no data rollback is needed. Never reset tasks, batch history, or reminder records to reverse this UI change. The staged patch is checked in a temporary index in both directions before committing.
