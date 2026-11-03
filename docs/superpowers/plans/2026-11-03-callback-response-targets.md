# Callback response targets implementation plan

**Goal:** Opt-in business-hours targets for CRM handoff and first recorded contact, with an actionable queue and private, deduplicated in-app escalation to a designated manager. User approved the in-chat description through “go”; finish testing, fixes, merge and deployment under existing session authorization.

**Architecture:** Use the standard business-calendar deadline pattern and immutable configuration versions. A separate five-minute reconciliation job materializes response deadlines; existing notification delivery reads their live eligibility. Escalation failures cannot block visitor submissions, CRM operations, or ordinary callback notification generation. No dependencies or AI/phone/outreach calls.

## Decisions and limits

- Disabled by default. Defaults: 60 business minutes for handoff, 120 for first attempt; explicit manager selection and acknowledgement before enabling. A manager must be a current organization member with settings and CRM read/write permissions.
- Snapshot the saved business timezone, weekly days and same-day opening interval on explicit policy save. Save protects policy/business versions and preserves unrelated phone settings. Editing/enabling adopts current hours and recalculates all waiting deadlines; changing the business profile alone does not silently change an active policy.
- Handoff clock starts at callback confirmation. Only pending callbacks without a handoff qualify. First-attempt clock starts at approved CRM handoff and does not reset on reassignment/rescheduling. A staff-reported Reached/No answer result satisfies it; Retry or task completion alone does not. Explicit callback closure and inactive/missing CRM targets remove eligibility.
- Count actual elapsed time within local opening windows, including timezone changes, weekends, fractional UTC offsets and DST gaps/repeated times. No overnight schedule or holiday overrides. Bound supported targets to 5–1,440 minutes and at most 52 nominal weeks of saved opening minutes; actual calendar searches are bounded to 400 local dates to accommodate skipped openings and DST.
- Preserve individual staff ownership. Escalation only notifies the manager; no automatic handoff, reassignment, calling, sending, task completion or fabricated outcomes. No visitor names/phones/notes or credentials in target/notification data.
- Live permissions, policy version, source phase and first-attempt state gate queue and notifications. Disabled/changed policies and removed/ineligible managers hide obsolete alerts. Unique escalation keys include policy/deadline/phase; retries cannot redeliver read alerts.
- Add a dedicated response-target page linked from receptionist Settings and Notifications. Admins configure; admins/staff see only the currently authorized queue. Navigation protects unsaved policy edits. Reads never materialize targets or create notifications.

## Tasks / verification

1. Write failing pure business-calendar tests, then implement native Intl calculations and strict contracts in `src/lib/callback-response.ts`. Cover half-open hours, weekend carry, source seconds, DST gaps/folds, fractional offsets and invalid/bounded schedules.
2. Add private `CallbackResponsePolicy` / `CallbackResponseTarget` tables and extend the notification kind constraint. Keep applied migrations forward-only. Add a shared role-union SQL helper; preserve existing notification keys/kinds unchanged. New SQL eligibility is shared by materialization, queue and escalation delivery.
3. Write failing disposable PostgreSQL tests; implement fresh-admin policy metadata/CAS saves, safe snapshot adoption, target reconciliation and fresh queue filtering. Reuse the existing notification writer for delivery after target reconciliation, without importing business-time calculation into normal notification generation. Add separate Inngest cron, concurrency1/retries3, and current-policy last-success metadata without bumping the configuration version.
4. Add authenticated, no-store GET/PUT policy and GET queue routes, strict bounded same-origin writes, and safe errors. Test auth, CSRF, scope, invalid fields, stale saves and retries.
5. Add policy editor/queue/page and links, matching existing UI. Test explicit acknowledgement, disable/reload/conflict behavior, stale responses, unsaved navigation, queue visibility and deterministic link generation. Mock all browser mutations and block providers in desktop/mobile E2E.
6. Fresh whole-branch review under executing-plans/requesting-code-review. Full npm test, lint --fix, strict/fast types, Prisma validation/build, new real disposable PG suite and existing notification/outcome/widget regressions. Preserve existing tests unless the user explicitly approves corrections; add no dependencies.
7. Before migration/release capture production metadata read-only and prove rollback in a temporary index: revert app code but retain expanded/additive schema, applied migration and receipts. Apply/record reviewed migration, inspect RLS/privileges/advisors. Commit/merge, test merged tree, push; verify CI/deployment and SDK scheduler registration. Production checks use mocked writes/read-only data; never run a production sweep as a test or activate a widget.

## Review focus

- DST and local-day boundaries must preserve real opening-window minutes and avoid unbounded scans.
- Policy edits cannot reuse stale target/notification versions or silently adopt changed hours; pausing must work despite invalid hours or a removed manager.
- Recorded Retry/manual task completion cannot masquerade as a contact attempt. Deleted source callbacks may retain approved CRM work, which must still be checked safely.
- Cross-organization roles, reassignment, manager removal and closure cannot leak queue rows, names, actions or escalation counts.
- Normal notification generation must retain its deduplication keys and keep working independently of the new calendar job.

## Execution record

Baseline: `454925467c326d12b23e07422507ea5599f5de42`. Preserve untracked `.serena/` and `.spec-workflow/`. Verification stays mocked/disposable/read-only; never retrieve/decrypt/use the real DeepSeek key or contact Twilio.

Implemented the policy editor, permission-filtered queue, business calendar, versioned reconciliation, manager escalation, and separate durable cron. Existing notification clients retain the original three kinds unless they opt into response-target kinds with a request header. No dependencies or existing test files changed.

Independent review found no critical or important issues. A minor documentation correction clarifies the nominal weekly capacity limit and the separate 400-date search bound. The reviewer independently ran the 15 focused unit tests.

Verified 1,543 unit tests across 190 files; 20 new disposable PostgreSQL tests; and existing notification (22), callback outcome (14), and website receptionist (20) database tests. Desktop/mobile policy, conflict recovery, pause, escalation, and read-state browser tests passed with mocked writes. Strict and fast TypeScript checks, lint with fixes, Prisma validation, and the guarded production build passed. Provider guard recorded zero blocked attempts.

Read-only production baseline found no response tables and zero notifications, callbacks, handoffs, or enabled widgets. No open pull requests reserved the migration version. Temporary-index rollback proof restored the exact baseline tree, then retained only the additive schema and migration; a second retention was a no-op. Migration was applied and recorded in Prisma, with RLS enabled and both browser roles denied table access. Both new tables remained empty. Advisor notices for RLS without policies are intentional for these server-only tables. Rollback instructions: `docs/ops/callback-response-targets-rollback.md`.

Deferred: holiday calendars, overnight openings, repeated escalation reminders, email/push delivery, and live provider or telephone verification. Retained the saved weekly-calendar design; adding holiday overrides later requires a versioned calendar extension and deadline recalculation.
