# Visitor feedback to FAQ drafts implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one independent whole-branch review before release.

**Goal:** Let an opted-in website visitor flag an unhelpful answer and let current organization administrators create a private, editable FAQ draft from the saved question.

**Architecture:** Extend website configuration with a default-off feedback switch and add private feedback and daily-counter tables. Advertise feedback only in sessions started with the switch enabled; reuse existing widget session/IP/origin/config binding and the last answered request ID. Store only visitor-reviewed question text after explicit consent, not transcripts, answers, contact details, or credentials. Reuse the Library draft/audit/cap conventions, keeping visitor feedback separate from saved rehearsal flags.

**Tech Stack:** Existing Next.js/React/Tailwind, vanilla iframe JavaScript, Prisma/PostgreSQL, Zod, Vitest/Playwright and Inngest. No dependencies.

**Spec:** User-approved chat: “This didn’t help”, administrator FAQ drafts, human publication/receptionist approval, opt-in saving and no extra AI calls. Session authorization covers finishing, tests, fixes, migration, merge/push/deployment. Mocks only; never retrieve/decrypt/use the real DeepSeek key or place calls.

## Constraints and decisions

- Baseline `8c699358353a3989e93a028db15cc2884e32a068`; branch `codex/receptionist-visitor-feedback` in the existing checkout. Preserve `.serena/` and `.spec-workflow/`.
- `WebsiteReceptionistConfig.feedbackEnabled` defaults false. A separate explicit admin save cannot enable the widget. Changing it uses the existing config version and expires active chats; normal website saves retain this flag.
- Session DTO adds only optional `feedbackEnabled: true`; disabled sessions retain their existing shape. Generation and answer DTOs remain unchanged. No new requests occur in disabled widgets.
- “This didn’t help” opens a review form. The visitor may remove personal information, then must explicitly consent before saving. Submitted text is visitor feedback, not a verified transcript. It is bounded to 1,000 characters/2,000 UTF-8 bytes. No question is stored merely because it was asked or the button was opened.
- Public POST requires a valid enabled widget, bearer session, application origin, allowed site, current config version, unexpired IP-bound session, completed latest request and no answer in flight. One feedback row per organization/session/request; same-body retries are idempotent, changed-body retries conflict. At most 50 new reports per organization/UTC day, serialized under the existing config lock. No AI/CRM/config/AI-usage write on submit; a private text-free daily counter enforces issuance even after deletion.
- Feedback expires after 30 days. Admin list/actions exclude expired rows even if cleanup is delayed. Extend the existing daily website cleanup job with a separate feedback step. FAQ drafts created explicitly in Library survive feedback expiry/deletion.
- Admin APIs/page require fresh local Settings permission and membership. List is explicit-load, status open/dismissed/all, twenty rows/page. Dismiss and permanent-delete use current version; delete needs UI confirmation. Creating a FAQ uses organization + row locks, the shared fifty-active-document cap and a durable draft ID for retry safety. No inferred answer, publishing or approval. Linked draft metadata is fetched only within the current organization.
- Add `/receptionist/feedback`, links from Receptionist home and Settings, and a distinct breadcrumb. Existing rehearsal inbox/FAQs remain unchanged.
- Additive private tables: RLS enabled; PUBLIC/anon/authenticated privileges revoked. No backfill, provider changes, automatic opt-in or production test records. Rollback keeps additive schema/migration and retained data while reverting application code.

This uses ordinary opt-in feedback, idempotent writes and optimistic versions. Questions can be edited before submission, so administrators must verify their content before drafting answers. Exact and semantic grouping across visitors is deferred; separate reports remain separate.

## Review focus

- Off-by-default and consent boundaries, stale sessions/config, wrong org/IP/origin, forged/stale request IDs, replay and concurrent caps must never retain unauthorized question text.
- Public retries must not create duplicates or reveal saved text/identifiers; expiry and purge must not delete explicitly created Library drafts.
- Fresh local membership, foreign roles and draft ownership must gate all admin operations; no credentials or full transcripts appear in DTOs or logs.
- Draft creation/deletion races and lost responses must preserve one draft and human publication controls; Library limits are shared with ordinary creation.
- Widget state must handle retries, new questions/chats, consent edits, errors and unmounts without auto-saving or breaking the current callback flow. Existing tests remain unchanged unless separately approved.

## Tasks

1. [x] Write failing contract/disposable PostgreSQL tests; add schemas, additive Prisma migration and feedback services. Verify default-off/session privacy, authorization, consent, idempotency/concurrency, cap, expiry, FAQ cap/ownership/draft status and purge. Run existing website and FAQ regressions unchanged.
2. [x] Write failing HTTP/page tests; implement scoped no-store policy/list/action/draft routes and public feedback POST using existing bounded body/origin/session helpers. Add cleanup step and tests.
3. [x] Write failing real-component/widget tests; implement admin policy/inbox, widget consent form and optional session capability, home/Settings links and breadcrumb. Retain existing widget, settings, Library and rehearsal behavior.
4. [x] Run full tests, lint autofix, strict/fast types, Prisma, build, disposable PG and mocked desktop/mobile browser tests. Independent whole-branch review; fix supported material findings with regressions.
5. [ ] Capture production schema/counts read-only, test a migration-preserving code rollback, apply additive migration and record Prisma history, verify disabled defaults/private roles. Merge/test/push, check CI/deployment and production with mocked business writes and read-only counts.

## Execution record

Initial state: planning only; no product/schema/production changes yet. Live provider requests, real-key access and production test-record creation are not authorized.

## Independent review fixes

- Durable daily accounting now survives feedback deletion. A separate private organization/day counter is updated only for a new consented report and expires after two UTC days; same-request retries consume nothing. The new deletion/cap regression failed before the fix and passes afterward.
- The visitor review form explicitly discloses that FAQ copies may remain after report expiry/deletion and asks visitors to remove personal details. A DOM consent-copy regression failed before the change and passes.
- Feedback-policy saves take the shared Organization lock before configuration, matching ordinary website settings saves. A real-PostgreSQL read barrier reproduced both stale writers succeeding before the fix; afterward exactly one succeeds. The scheduling wrapper is test-only and restores the real bound transaction method afterward.
- Widget feedback requests capture a chat generation and session token. Delayed success and expiry responses from an earlier chat cannot change a restarted chat. Both browser regressions failed with hidden replacement forms before the fix and now pass.
- No Critical findings or deferred Minor findings were reported. The four Important findings were fixed in one pass; no re-review was requested.

## Release verification

- Baseline 1,640 tests passed. Final reviewed code passed 1,660 unit tests in 215 files, strict and fast TypeScript, ESLint autofix, Prisma validation and production build. No dependencies or existing test files were changed. The isolated widget config was broadened to include the new suite.
- Disposable PostgreSQL: 14 feedback privacy/concurrency/expiry tests, 20 website regressions and 7 existing rehearsal FAQ tests passed. Twenty isolated widget browser checks, four built-app admin/API checks including auth, and fourteen Settings/setup/Library/rehearsal/inbox regression checks including auth passed. Desktop/mobile dark screenshots were inspected. Initial new browser selectors were corrected to account for conversation speaker text; a capability-gate regression was then proved failing before restoration and a complete green rerun.
- Independent review found four Important issues, all fixed and verified RED→GREEN above. No second review was requested.
- Rollback proved exact baseline restoration, then retained only additive schema/migration and expiry files; the recovery tree passed strict types and its cleanup test.
- Migration 20261103070000_add_visitor_feedback applied with checksum 6220c2d6f822427ec27a81b7ce6c4719fa79d509846f16e037812d26a3259486. Private table grants/RLS and zero opt-ins/reports/counters/widgets/documents/callbacks verified read-only afterward. No live provider or native website transport was attempted; no real key was retrieved/decrypted or used.
- Merged-tree tests, CI/deployment and production browser/read-only verification follow the authorized merge/push. Production business mutations remain mocked; collection is not enabled by deployment.

Not performed: live AI/phone/website requests, production opt-in or test-record creation, automatic answers/publication/approval or semantic grouping. Admin-created FAQ copies deliberately survive feedback expiry; visitors are told this before consenting.
