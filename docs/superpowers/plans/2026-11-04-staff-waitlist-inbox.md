# Staff waitlist inbox implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. One fresh-context reviewer checks the complete branch before merge.

**Goal:** Let explicitly authorized Flowrish staff review global waitlist signups and approve one CRM handoff without contacting prospects automatically.

**Architecture:** Add a membership-bound server-only staff grant, independent review state, and a durable handoff receipt. New staff services and routes revalidate authorization and concurrency; the client previews changes before CRM confirmation. Reuse existing session, permission, transaction, bounded-body, and error-response patterns.

**Tech stack:** Existing Next.js, React, Prisma/PostgreSQL, Zod, Vitest, and Playwright. No project dependencies added.

**Spec:** `docs/superpowers/specs/2026-11-04-staff-waitlist-inbox.md`

## Global constraints

- Widget off; no DeepSeek, provider requests, real leads, or emails during verification.
- Existing test assertions remain unless the user explicitly approves corrections. Demo-link assertion changes are approved.
- Global waitlist access requires the exact server-managed membership grant, not an organization-admin role.
- Preserve signup status, duplicate-email privacy, existing email behavior, and first-touch attribution.
- No automated outreach or invitations. New CRM records require a preview and explicit approval.

## Review focus

- Ungranted administrators and organization switching must not expose global prospect data.
- Revoked membership/grant and foreign CRM destinations must fail before writes.
- Concurrent edits, double confirmations, and uncertain retries must not duplicate handoffs.
- Deleted CRM targets must leave a durable receipt and must not recreate data.
- Demo-source URLs must remain public and preserve a working waitlist anchor in either signup mode.

## Task 1: Staff authorization and review workflow

Files: Prisma schema and additive migration; `src/server/auth/waitlist-staff.ts`; `src/lib/staff-waitlist.ts`; `src/server/services/staff-waitlist.ts`; staff API routes; new service/auth/route tests; `docs/ops/staff-waitlist-rollback.md`.

- [x] Write failing authorization and list/update tests: exact grant, other org denied, no PII query before authorization, bounded pagination, independent review status, version conflicts.
- [x] Add membership grant, review fields, and handoff receipt schema. RLS/revoke browser roles; preserve existing data/defaults.
- [x] Implement bounded staff APIs and grant checks. Protect page requests too.
- [x] Run narrow tests. Exercise migration, browser-role denial, grant/revoke round trip, and existing signup compatibility against a disposable local database.

## Task 2: Explicit CRM handoff

Files: staff service, contract and handoff routes; new transactional tests.

- [x] Write failing tests for read-only preview, foreign/deleted/closed destinations, invalid owners/stages, duplicate acknowledgement, stale preview, and revocation.
- [x] Implement scoped choices and preview hashing. Commit under organization/source/grant/member/destination locks, recheck freshness, and write one receipt atomically.
- [x] Test retries return the receipt with no second lead, existing-lead linking changes no owner, and missing targets are never recreated.
- [x] Run narrow service tests and synthetic local PostgreSQL transaction/concurrency checks.

## Task 3: Inbox UI and demo attribution

Files: staff inbox client/page; conditional Admin link; marketing page/form/API and public-demo link; new UI/source tests; approved demo link assertions; browser spec/fixture/config/count.

- [x] Write failing UI tests for access, pagination/filtering, statuses, no automatic writes, form edits clearing approval, and recoverable errors.
- [x] Implement responsive inbox and explicit preview/confirmation, including receipt states and record-only contacted wording.
- [x] Add fixed source handling and approved link assertion updates while preserving existing coverage.
- [x] Add desktop/mobile mocked browser workflows and authorization/error scenarios. Preserve existing 19 scenarios and update the exact runner count with the new selection.
- [x] Run formatter, narrow tests, full unit suite, both type checks, lint, guarded build, and isolated browser command. Do not run strict type checks alongside the Next build.
- [x] Obtain one independent read-only review, fix findings with regression tests, and recheck affected paths.
- [x] Verify rollback and record baseline metadata. Apply the additive migration and verified owner grant.

Release after these gates: merge/push the tested tree, verify CI/deployment, and check production read-only. Never submit the live waitlist or handoff. Private release evidence records the final CI/deployment results.

## Execution ledger

- Access decision: explicit membership grants prevent customer admins from seeing the global waitlist. Additional staff need operator provisioning.
- CRM decision: lead-only handoff; a waitlist signup provides no callback consent or task instructions.
- Source-test approval: user approved updating existing demo-link expectations while retaining every other assertion.
- Production baseline: waitlist has zero entries; existing Flowrish owner membership verified read-only. No prospect records have been queried.
- Incident: an intended local baseline push used the repository's production datasource before schema edits. Disclosed immediately, audited metadata, restored/verified the Library GIN index, declared it in Prisma, and added AGENTS.md instructions prohibiting that test setup. Subsequent database testing uses offline SQL in Docker and an explicit loopback PrismaClient URL.
- Independent review: no blocking findings. Adopted its minor recommendation to restrict receipt-organization deletion; an initially failing synthetic regression now passes. Organization retirement must preserve/handle receipts explicitly.
- Browser selector correction: user approved narrowing new alert selectors to the intended error text; all other assertions remain. A separate product regression now ensures only one live status announcement during refresh.
- Verified: 24 browser scenarios with zero guard violations; 11 disposable PostgreSQL tests; legacy-row preservation and repeatable exact-grant rollback. Full checks passed: 1,808 unit tests, lint, strict/fast types, and guarded production build. The additive migration and one verified owner grant are applied; record counts remain unchanged, receipts zero, widget off. Merge and CI/deployment verification remain in progress.
