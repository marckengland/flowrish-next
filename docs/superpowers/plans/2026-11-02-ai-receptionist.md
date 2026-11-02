# AI receptionist implementation plan

**Goal:** Answer inbound calls after hours, collect and confirm a caller's name, callback number, and request, then save a lead, call activity, and assigned callback task.

**Architecture:** Twilio Gather/Say speech webhooks use the existing AI provider. Configuration and bounded call state persist in PostgreSQL. A transaction claims each call turn before writing CRM records, so webhook retries cannot repeat confirmed actions. The receptionist uses owner-supplied business information and never receives existing CRM records.

**Constraints:** No added dependencies, commits, pushes, PRs, live migrations, or external calls. Disabled by default. Existing outbound calling stays separate. Work happens on codex/ai-receptionist in the existing checkout. Streaming voice, appointment booking, live transfers, and automatic email sequences are deferred. Turn-based speech makes interruptions harder than a streaming service would.

**Baseline:** npm test: 922 passed, 1 failed. Existing failure: task-form.test.tsx expects SELECT for priority but receives INPUT. Leave the test unchanged.

## Tasks

- [x] Add failing tests for configuration, business hours and next opening across time zones, XML escaping, deterministic confirmation, silence, and turn limits. Implement pure receptionist helpers.
- [x] Add disabled configuration and call-state models, tenant scope, additive migration and rollback instructions. Generate the local Prisma client only.
- [x] Add tests for tenant-bound configuration, signature verification including query strings, AI failure fallback, retry deduplication, and atomic confirmed CRM capture. Implement admin and signed inbound endpoints and bounded AI extraction.
- [x] Add a settings panel using existing components, save/error feedback, caller setup instructions, and recent call outcomes. Keep business configuration separate from credentials.
- [x] Run focused tests, lint with autofix, Prisma validation, full tests, typecheck, and build. Review the diff for missing authorization, cross-tenant references, concurrency, and failure disclosure. Report the baseline failure and any unverified live paths.

## Review focus

- No token or signature means no AI use or data mutation.
- CallSid, Twilio account, and destination must belong to the configured organization.
- Duplicate/concurrent confirmation must create one callback and activity.
- Caller corrections and silence must never count as confirmation.
- Provider failure and incomplete calls must still have an explicit, honest outcome.

## Verification and review

- New coverage: 38 tests across conversation, scheduling, AI request/extraction, service persistence, webhook authentication, admin permission checks, and settings form behavior.
- Full suite: 960 passed, 1 failed. The failure is the unchanged baseline `task-form.test.tsx:112`: expected `INPUT` to be `SELECT`.
- Production build, ESLint, TypeScript, and Prisma validation passed.
- Browser preview with sample data: desktop 1440px and mobile 390px rendered without page errors or horizontal overflow. This preview does not verify authenticated application or database integration.
- Independent review found a DST-gap callback date bug and an unconditional post-forwarding failure announcement. Both were reproduced with failing tests and fixed. DST gaps use the first valid business minute on the scheduled local date; forwarding uses neutral post-call wording.
- Other regression fixes cover provider failure during a correction, keypad callback entry, maximum-length readbacks, disabling after a removed assignee/stage, and provider error-body redaction for public calls.
- No migration was applied to a live database. No live calls, real provider responses, or real PostgreSQL concurrency were exercised. A local PostgreSQL container was unavailable because Docker was not running.
- No dependencies were added and no commits, pushes, PRs, or deployment were made.

## Completion follow-up

The user requested completion and merge on 2026-11-02, and explicitly approved correcting the stale task-form SELECT assertion to verify the existing accessible priority chips and submitted value.

- The normal unit suite now passes all 962 tests.
- Four real PostgreSQL integration tests pass, including eight concurrent confirmation deliveries producing exactly one callback, transactional rollback after an injected task-write failure, tenant isolation, Data API grant checks, and idempotent disabling.
- Docker was started using the existing installation and existing PostgreSQL image. No packages or images were downloaded.
- Added read-only application e2e coverage for the receptionist settings and public webhook authentication boundary.
- Rollback evidence and pre-change database counts are recorded in `docs/AI_RECEPTIONIST_ROLLBACK.md`.
- Live phone activation is unavailable because the application has no stored Twilio voice configurations. Vercel CLI authentication is also expired; neither a real call nor CLI deployment can be represented as verified.
