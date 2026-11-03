# Callback Notifications Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh whole-branch review. User approved the in-chat feature description through “go”; continue testing, fixes, merge and deployment under existing session authorization.

**Goal:** Notify current organization administrators about unhandled website callbacks and current CRM owners about assigned/overdue callback work, without duplicate alerts or provider requests.

**Architecture:** Periodically reconcile existing callback, handoff, task and outcome records into a small private notification table. This is the standard idempotent reconciliation pattern: unique event keys make scheduler retries safe; live eligibility is checked again on reads. Existing visitor submission and CRM commit transactions remain unchanged, so alert failures cannot fail those workflows.

**Tech Stack:** Existing Next.js/React, Prisma/PostgreSQL, Inngest, Zod, Vitest, Playwright. No dependencies.

**Spec:** The accepted in-chat proposal: in-app notifications for confirmed requests, current owner alerts after handoff, overdue reminders with a task link, and retry deduplication. This plan supplies routine implementation choices.

## Global constraints and choices

- Never retrieve/decrypt/use the real DeepSeek key, contact live AI/Twilio, or use external delivery services. Verification uses synthetic disposable databases, mocked browser writes, and read-only production checks.
- Preserve unrelated `.serena/` and `.spec-workflow/`. Existing tests require explicit approval before edits; new tests do not replace existing assertions. Add no dependencies.
- Five-minute scheduled sweep; header unread count refreshes at most once per visible minute and on explicit actions/focus. No browser push/email/SMS. This makes instant delivery a later feature.
- Only current pending callbacks without a CRM receipt notify admins with `admin:settings`. Assigned work requires current membership, `leads:read` + `leads:write`, the current task owner, an active lead/task and no closed callback outcome. Overdue replaces the assignment alert once the deadline passes.
- A task's saved `updatedAt` is its alert version. Owner/deadline edits or reopening create a new event; other saved task edits also create a new version. One overdue reminder per version, never repeated every sweep.
- Store only recipient/source IDs, kind, source version, due date, delivery/read timestamps. Names, phone numbers, questions, notes, provider settings and credentials stay out of notifications.
- Live candidate eligibility hides obsolete alerts immediately after review, handoff, reassignment, rescheduling, completion, closure, deletion or permission loss. Historical deduplication rows remain private; membership removal cascades its alerts. Reads never create alerts.

## Review focus

1. Role permissions from another organization never confer access; union of current team role permissions must match existing application semantics.
2. Identical concurrent sweeps and retries add one row per recipient/event; marking read never removes deduplication evidence.
3. No stale owner, source, deadline, deleted lead/task, or closed request leaks through unread counts, list or mark-read operations.
4. Header polling stops when hidden/unmounted and keeps failures distinct from a genuine zero; client pages reject stale/malformed responses and guard duplicate actions.
5. Migration enables RLS, revokes public API roles, validates keys/kinds and cascades membership deletion. Rollback preserves additive schema and read/dedupe state.

## Tasks

### 1. Private schema and reconciliation

Create `CallbackNotification` and `20261103050000_add_callback_notifications/migration.sql`; relate notifications to Organization and the existing OrganizationMember unique pair. Create `src/server/services/callback-notifications.ts` with `reconcileCallbackNotifications(organizationId)`, `runCallbackNotificationSweep()`, `getCallbackNotificationCount(org,user)`, `listCallbackNotifications(org,user,query)`, and `readCallbackNotification(org,user,key)`. Use one shared SQL candidate CTE for delivery and live access, plus deterministic SHA256 event keys and `ON CONFLICT DO NOTHING`.

- [x] Write and observe failing disposable PostgreSQL tests in `scripts/callback-notifications.integration.test.ts` / `vitest.callback-notifications.config.ts` for the five review risks, permissions, source privacy, read-only reads and no provider/CRM changes.
- [x] Implement additive migration, generate the existing Prisma client, add contracts in `src/lib/callback-notifications.ts`, and make the focused tests pass.

### 2. Authenticated API and scheduled sweep

Create GET list/count and same-origin bounded PATCH mark-read under `/api/callback-notifications`. Add static safe errors/no-store, strict query/body validation and current session scope. Register a new five-minute Inngest function, concurrency 1, retries 3; do not modify the existing generic task reminder.

- [x] Add failing HTTP and scheduler tests, implement, and verify authentication, tenant isolation, CSRF, validation, retry behavior and safe errors.

### 3. Bell and notification inbox

Replace the inert header bell with a small polling count/link component. Add `/notifications` and a client inbox with unread/all filters, pagination, refresh, explicit mark-read and direct callback/task actions. Static text represents notification kinds; links are generated from validated IDs. No write on open, mount or follow-link.

- [x] Add failing unit tests for polling, visibility, cleanup, errors, read actions, pagination and inaccessible/stale results; implement with existing UI primitives.
- [x] Add mocked desktop/mobile browser coverage including the header badge, unread/all, mark-read retries, links, inert text and blocked providers/unrelated writes.

### 4. Review and release

- [x] Fresh whole-branch review; fix material findings with regression tests. Run full npm test, lint --fix, tsc, fast types, Prisma validate, build, new disposable PostgreSQL tests and existing callback/web browser regressions.
- [x] Capture production metadata before migration; write and prove a rollback that reverts code while retaining the additive schema/migration and notification receipts. Apply the reviewed migration, confirm RLS/privileges with read-only SQL and security advisors.
- [ ] Commit/merge the isolated branch, verify merged tests, push and observe CI/deployment. Verify deployed paths with mocked writes and read-only APIs. Never invoke the production notification sweep as a test or activate a widget.

## Execution record

Baseline `3a1f127e04de1b339cb786db92467007f7411127`: 1,518 unit tests passed. Read-only production queries confirmed the table was absent, with zero callbacks, handoffs and enabled widgets.

- New UI/HTTP/scheduler tests were observed failing before implementation. Two additional UI regressions reproduced stale-count and expired-action races before their fixes. All 1,528 unit tests, 22 disposable notification database tests, 14 existing outcome database tests and 20 existing widget database tests passed. Lint, strict/fast types, Prisma validation and production build passed.
- Independent review found no important defect and suggested a clock-only overdue case; the added test confirms that time passing alone replaces assignment with overdue without modifying the task version. The reviewer independently passed all 10 focused UI/HTTP/scheduler tests.
- Desktop/mobile browser verification passed using mocked mutations. A selector initially matched both the application error and Next's route announcer; scoping it to the application main preserved the intended assertion. No preexisting test was changed.
- A temporary index proved reversal restores the baseline application tree. Preserving only the additive schema and migration is idempotent. The private migration was applied and recorded through Prisma migrate resolve; RLS and denied anon/authenticated table access were verified. Security advisors report only the expected INFO that a private, denied table has no public policies. No test production alerts or CRM rows were created.
- Production scheduler introspection correctly requires a signed request; do not weaken it for verification. After deployment, sync the complete function list through the existing SDK registration endpoint and verify success rather than inferring registration from configured keys.
