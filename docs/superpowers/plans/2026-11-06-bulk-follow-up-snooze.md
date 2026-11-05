# Bulk follow-up snooze implementation plan

> Use superpowers:executing-plans inline, TDD and one fresh whole-branch review.

**Goal/spec:** User-approved bulk snoozing of selected loaded follow-ups, reviewed before applying, preserving unsent drafts and showing clear outcomes. No new dependencies, widget activation, DeepSeek calls, real emails or production test writes.

**Architecture:** Standard bounded sequential batch with optimistic version checks. At most 20 currently loaded pending follow-ups, one shared valid future local time/timezone, immutable reviewed versions. Reuse the existing scoped POST snooze operation and stop on the first failure or uncertainty. Never retry mutations automatically. Add a read-only GET to the same snooze route for explicit result verification under fresh membership, lead, task and permission checks. No new batch schema, migration, worker or receipt storage.

**Client:** Per-card selection and a named Bulk snooze section support review, confirmation, current-item progress, per-item outcomes and read-only Check results. Confirmed reminders retain selected cards until selection clears; keyed composers and draft fields remain mounted. Selected IDs join retained drafts during list revalidation. Clear/filter/tab changes prune selection; background reads and navigation pause during a batch. A changed selection/version invalidates review. Stale account/access clears private state; a read or write error stops the remaining queue. Unknown writes are verified by current reminder state, never replayed; new writes require a new review.

**Tradeoff:** Per-item transactions can partially complete; outcomes identify saved, verified, failed, unconfirmed and not-attempted items. A future all-or-nothing batch would require a separate server operation. No cumulative or cross-device batch history is introduced. Existing task due dates, callback deadlines and email approval remain unchanged.

## Tasks

- [x] Task 1 RED→GREEN: bounded unique selection, valid unambiguous future time, sequential scoped requests, exact receipt verification, no automatic retries, stale-context/abort stop and read-only reconciliation. New GET reminder reader/route authorize current sources, return minimal personal metadata, and create no work.
- [x] Task 2 RED→GREEN: per-card loaded selection and reviewed toolbar, 20 cap, review invalidation, same-time summary, partial/uncertain results, read-only verification, preserved filters/composer identity and edit values. Pause conflicting navigation/reads and retain selected IDs. Existing single-snooze behavior stays compatible.
- [x] Task 3: six approved mocked browser cases, 136→142 retaining every prior case/guard. Disposable PostgreSQL proof for GET privacy, unchanged write guards, partial batches, stale versions, audit uniqueness, concurrency, rollback, and no extra work/provider calls.
- [x] Task 4: full tests/lint/build then strict/fast checks, full142 browser rehearsal and one fresh whole-branch review. Fix substantive findings with a failed-then-passing regression.
- [ ] Task 5: combined rollback-patch proof, authorized commit/merge/push, all CI jobs, exact-SHA production release and anonymous widget/privacy checks. Preserve managed checkout and unrelated files; archive only this task's scratch.

## Review focus

No cross-user/workspace result or selection survives a context change. A lost response must never trigger another POST; verification uses GET only. A mid-batch failure or permission change stops remaining writes and preserves honest partial results. Changing data after review must not silently substitute fresh versions. Bulk snoozing and clearing results must keep open composers/edits mounted while personal reminders update. Retained selected rows must be freshly authorized, not a permanent cache; read-only verification must not create callbacks, leads, tasks, audits or AI work.

## Verification and rollback

Passed 2,370 tests in 368 files, lint, production build, both post-build type checks, and all 142 guarded browser scenarios. All 136 existing browser scenarios and every network/write guard remain. Approved fixture corrections retained every assertion. Desktop/mobile checks cover reviewed saves, filters, composer identity, clearing, uncertain receipt verification, stale versions/account, the 20-item cap, keyboard selection, and read-only access. The mobile screenshot was visually inspected.

The fresh review found task-only editor loss on Clear selection. A new regression failed before the fix and passed afterward: unsaved title, notes and due date now remain mounted after clearing and background revalidation. Focus events received during a successful read are coalesced into one trailing revalidation so role loss is detected; failures never trigger that retry.

The disposable PostgreSQL 17 drill passed sequential saves, stale replay rejection, GET-only verification of a lost receipt, partial transaction rollback, no attempts after a failure, one concurrency winner, write-revocation queue stop, read-only metadata, cross-user/workspace and reassigned-source denial, exact source/task preservation, and no extra work. All 41 migrations/privacy/DDL rollback checks passed and the owned container was removed.

Rollback is a normal code revert. Successfully saved personal reminders and their audits remain as valid user actions; rollback does not unsnooze work or rewind later edits. No schema, dependency, widget, or deployment-secret changes are required. Live providers and real email delivery were not exercised, and no production test writes were made. Batches are per-item transactions, not all-or-nothing operations; batch history is not persisted across devices.
