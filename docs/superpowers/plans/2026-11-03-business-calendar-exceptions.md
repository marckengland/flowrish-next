# Business calendar exceptions implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh whole-branch review at the end. Preserve the session's authorization to finish, test, merge and push.

**Goal:** Administrators can close specific dates or set different hours, callback choices respect those dates, and affected existing callbacks require staff review without moving their saved times.

**Architecture:** Add optional, bounded date overrides to existing JSON business settings and response-policy calendar snapshots. Use shared validation and local-date opening intervals throughout the current calendar paths. Compute review warnings from current calendar and retained callback/task data; create no additional records or scheduler.

**Tech Stack:** Existing TypeScript, Intl, Zod, React, Prisma, PostgreSQL, Vitest and Playwright; no dependencies or schema migration.

**Spec:** Accepted chat recommendation: mark dates closed or change their hours; apply exceptions to callback choices and response targets; flag affected callbacks for staff review without automatic rescheduling. Widget off, no real DeepSeek/provider calls, mocks and disposable databases only for verification writes.

## Global constraints

- Maximum 100 distinct explicit ISO dates; valid dates from 2000 onward. A date is either closed or has one opening-inclusive, closing-exclusive same-day interval. An override replaces that date's weekly rule and may open a weekend. No labels, private notes, recurring holidays, split shifts, overnight hours, automatic holiday imports or external booking.
- Preserve existing payloads when no exceptions exist. Old business-save clients that omit the optional field retain saved exceptions. Explicit empty arrays remove them. Calendar changes invalidate visitor consent, staff previews and setup review through existing version checks.
- Response policies retain reviewed calendar snapshots. The editor shows current and adopted overrides, warns when they differ, and requires existing acknowledgement before adopting/recalculating waiting targets. Do not change callback task deadlines or contact anyone when saving a calendar.
- Pending timed requests outside current hours or using an old timezone, and active handed-off tasks outside current hours, show a review warning. Retained receipts continue working after source deletion. Warnings clear when staff confirms an allowed time; no warning for legacy untimed requests or completed/closed tasks.
- Read/decrypt no real AI key. Do not enable a website widget, insert production test data, add dependencies, or change existing tests without user approval. Preserve unrelated tooling directories.
- Work on codex/business-calendar-exceptions in the current checkout. Reuse current UI controls/layout. Code rollback retains JSON overrides; deployment of an older calendar implementation must keep reception paused until time-aware code returns.

Tradeoff: manual date overrides do not establish staff capacity. A future calendar integration needs an availability model and must reconcile these closures explicitly.

## Review focus

- Business-local dates versus device/UTC dates, DST gaps/folds, date validation and closing boundaries.
- Omitted versus explicitly cleared overrides in old save clients, malformed saved calendars, tenant scope and concurrent calendar writes.
- Existing callback/task times and original consent remain unchanged; warnings work for removed sources and clear after reviewed rescheduling.
- Response-policy snapshots cannot silently adopt calendar changes; closure-heavy schedules still calculate bounded deadlines.
- Public calendar metadata exposes only timing; old cached embeds remain functional and all verification blocks provider transports.

## Task 1: Shared calendar rules

Files: new src/lib/business-calendar.ts and business-calendar-exceptions.test.ts; src/lib/callback-response.ts, callback-time.ts, receptionist.ts, receptionist-setup.ts.

Interfaces: calendarExceptionsSchema, openingHoursForDate(schedule,date), isWithinBusinessHours(date,schedule), calendarExceptionsText(schedule). Optional calendarExceptions travels with existing schedules. Existing businessCalendar and callback resolution APIs stay unchanged.

- [x] Add failing tests for closure, reduced hours, weekend opening, invalid/duplicate/bounded dates, optional contracts, Manila local-date boundaries, DST, and long closure sequences. Run focused Vitest: expected feature assertions fail.
- [x] Implement shared date overrides and integrate existing response deadline, callback validation, phone opening and hours-template calculations. Re-run new and existing calendar tests: expected all pass.

## Task 2: Persistence, public metadata and staff warnings

Files: receptionist setup/readers, callback response metadata, website receptionist, callback handoff/outcomes and their shared schemas; standalone widget; new calendar-exceptions integration and widget tests/config.

Interfaces: existing settings and policy JSON carry optional calendarExceptions; optional calendarReviewRequired on callback/detail views. Existing mutation requests, authorization and approval/version checks remain authoritative.

- [x] Add failing disposable-DB cases for roundtrip/preservation, clear, authorization, stale preview, retained-source warnings and reviewed policy adoption/deadline recalculation. Add public widget closure/readback tests with routes mocked. Expected failures prove missing exceptions/warnings.
- [x] Implement safe metadata propagation, old-client preservation, current-calendar warnings and widget validation. Run focused DB/widget suites: expected all pass with unchanged CRM dates on calendar-only writes.

## Task 3: Settings and review UI

Files: new src/components/receptionist/business-calendar.tsx and tests; existing setup wizard, receptionist settings, response-policy editor, callback panels/inbox and Demo rendering.

Interfaces: CalendarExceptionsEditor({value,onChange,timeZone,disabled?}) and CalendarExceptionsSummary({value,timeZone}); parent forms retain current save/discard behavior. Changes reset existing approvals.

- [x] Add failing UI tests for adding/removing closed/custom dates, duplicate/invalid input, unsaved changes, read-only policy snapshots and callback warnings. Expected feature controls absent before implementation.
- [x] Add compact labelled controls using existing form styles, explicit business timezone and summaries. Display staff review warnings and preserve the current approval path. Run focused new and legacy tests: expected pass, no existing assertions removed.

## Task 4: Verify and release

- [ ] Run full unit suite, lint autofix/lint, strict and fast types, Prisma validation, guarded production build, new and affected disposable-DB suites, standalone widget tests, desktop/mobile mocked browser checks. Inspect screenshots and provider guard.
- [ ] One independent fresh-context review; reproduce/fix material findings with regression tests. Read-only production prestate; verify retained-JSON rollback in a temporary Git index and disposable DB. No production business settings changes.
- [ ] Commit/merge, verify merged full checks, push and verify CI/Vercel. Run deployed browser tests with writes/providers mocked and read-only confirmation that widgets remain off and no callback records were created. Archive execution evidence.

## Execution record

Baseline 15f6627; prior release 1,708 unit tests and relevant database/browser checks passed. New work executes inline under the accepted scope; release results live in the task ledger.
