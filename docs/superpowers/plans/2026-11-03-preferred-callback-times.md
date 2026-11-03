# Preferred callback times implementation plan

> **For agentic workers:** Use superpowers:executing-plans, inline, with one independent whole-branch review at the end.

**Goal:** Visitors can request a callback date/time within saved business hours; staff confirm or reschedule it through existing reviewed CRM operations, and Demo mode rehearses the same flow without real writes.

**Architecture:** Add nullable JSON preference snapshots to callback sources and handoff receipts, plus a nullable submission hash to sessions for safe timed-request retries. Store the UTC instant, business timezone, local readback, and business-settings version together. A pure Intl-based validator resolves local times, rejects gaps/folds and out-of-hours or stale requests, and validates staff choices. Existing deadlines remain staff-controlled and are changed only by the existing preview/approval flows.

**Tech stack:** Existing Next.js, React, TypeScript, Intl, Zod, Prisma/PostgreSQL, standalone widget JS, Vitest/Playwright. No dependencies.

**Spec:** Accepted chat proposal: request a date/time using the business's saved timezone/hours; include it in consent and CRM handoff; staff confirm/reschedule before updating the task; cover the workflow in Demo mode. Keep the production widget off. Never read/decrypt/use the real DeepSeek key or make AI/Twilio calls. Verification uses mocks and disposable databases.

## Decisions and limits

- Optional preference; legacy callbacks and payloads continue to work. Show an explicit requested-time label and do not promise an appointment. Supported horizon is 90 days, minute precision, saved same-day weekly opening hours. Holidays, capacity, overnight shifts, external calendars, appointment booking, and notifications are outside this release.
- Resolve business-local time to one UTC instant using Intl offsets around the requested date. Reject nonexistent or ambiguous DST times and invalid calendar dates. Closing time is exclusive; opening time inclusive. Recheck future time and the current saved calendar on the server. Require matching business version and timezone for visitor consent.
- Keep original requested timing in source/receipt snapshots and task descriptions, including after source deletion. Staff see requested and chosen timing in preview. A changed deadline invalidates approval; calendar changes invalidate a previous staff preview. For timed callbacks, first-contact targets start at the staff-confirmed task time under existing reconciliation. Untimed callbacks retain their current target rule. No extra notification or policy writes are introduced.
- New session metadata exposes only saved timezone, weekdays, opening/closing times, and settings version. Never return private phone notes, provider settings, or credentials. Existing tenant/role checks remain mandatory.
- Additive nullable columns only. Roll back application code while preserving columns, stored requested times, handoff snapshots, and session retry hashes. Do not drop timed-request data or restore the whole database. Test the forward/undo path on a disposable database before production migration.
- The user approved extending existing Demo/session fixtures for safe calendar metadata while retaining all original privacy, authorization, and workflow assertions. Other existing-test corrections or dependency changes still require approval.
- Work in place on a codex branch per established session preference, preserve untracked tooling directories, implement inline, and use existing authorization to commit/merge/push after verification.

Tradeoff: saved weekly hours cannot establish staff availability or reserve an appointment. A new calendar integration would need its own availability model later.

## Task 1: Time contract and persistence

Files: new `src/lib/callback-time.ts` and tests; `prisma/schema.prisma`; new additive migration; relevant shared schemas.

- [x] Write failing tests for valid Manila conversion, closing boundary, weekends, invalid/past/over-90-day dates, DST gaps/folds, fractional offsets, stale timezone/version, and UTC formatting.
- [x] Implement pure calendar/preference schemas and validators without dependencies. Extend contracts using optional metadata so old payloads remain valid.
- [x] Add nullable preference snapshots and retry hash; generate Prisma client; prove persistence and rollback/data preservation in a disposable database.

## Task 2: Visitor request and consent

Files: website receptionist service/HTML, standalone widget JS, new focused server/widget tests.

- [x] Write failing tests for optional session calendar, consent readback, corrections, rejection before quota/write, stale calendars, matching retries, changed timed retries, and source-deleted retry safety.
- [x] Return safe calendar metadata, validate/lock saved business hours during timed submission, persist canonical preference/hash, render optional business-local input, and retain retry payload exactly.
- [x] Keep old no-preference request behavior and existing workflow assertions. No real website widget activation or production test records.

## Task 3: Staff confirmation and Demo mode

Files: handoff/outcome services and schemas, staff components, demo reader/reducer/component, new tests and approved fixture extensions.

- [x] Write failing tests for requested-time visibility, confirmed/rescheduled business-local time, fresh approval, changed-hours preview conflict, retained source metadata, no-time legacy compatibility, and simulated-only behavior.
- [x] Use chosen time as the existing task deadline after explicit staff preview/approval; preserve requested timing on durable receipts. Validate future business-hour choices before handoff and reschedule mutations.
- [x] Add optional preferred time and staff confirmation controls to Demo mode, sharing the pure validator and using fictional in-memory state only.

## Task 4: Verify and release

- [ ] Run focused tests, full units, formatter/lint, strict/fast types, Prisma validation, optimized build, disposable PostgreSQL integration/rollback checks, standalone widget and desktop/mobile browser checks. Block all live provider transports.
- [x] One fresh independent review; fix material findings through failing regressions and complete the full checks. Preserve all existing tests unless an explicitly approved update is required.
- [x] Inspect production schema/state read-only and current Supabase docs; apply only the additive migration with migration history recorded. Keep widget off and records unchanged.
- [ ] Commit/merge, verify merged checks, push and verify CI/deployment, then run deployed browser checks with writes/providers mocked. Report limitations and rollback.

## Review focus

Local timezone versus browser timezone; DST gaps/folds and inclusive/exclusive boundaries; consent/version races and immutable retries; tenant/role scoping; staff choice approval and deleted-source retention; existing payload/session compatibility; privacy, safe text rendering, no actual model/provider requests, no production test records.

## Execution record

Baseline `7063840`. Existing full baseline 1,683 units and all required checks passed on the prior release. User approved calendar-metadata test fixture extensions. No business configuration changes are authorized by this feature; widget remains disabled.
