# Approved pilot onboarding implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Request one fresh-context whole-branch review before merge.

**Goal:** Let approved prospects create their own organization from a private, email-bound pilot link without automatic outreach.

**Architecture:** One private invitation/receipt row per waitlist signup, with hashed rotating credentials and durable consumption. Staff APIs reuse explicit staff grants. A public static pilot page exchanges a fragment into an HttpOnly cookie; authenticated redemption uses an existing organization initializer with an injected transaction client. Login callbacks preserve pilot context and validate local continuation paths.

**Tech stack:** Existing Next.js, React, Prisma/PostgreSQL, Zod, Vitest and Playwright. No new dependencies or secrets.

**Spec:** `docs/superpowers/specs/2026-11-04-approved-pilot-onboarding.md`

## Constraints and review focus

- Widget off; no DeepSeek, live auth/email, or real test organizations/users/records.
- Never use `prisma db push` for local verification. Copied schema, explicit temporary config, offline SQL and disposable Docker only.
- Preserve existing tests and default organization-creation behavior. Ask before correcting any outdated test.
- Test wrong/unverified email, other organization admins, revoked/expired/stale links, repeat/concurrent acceptance, and fault rollback.
- Verify plaintext credentials never appear in read APIs, query strings, auth continuations, persistent browser storage, or errors/logging.
- Verify pilot auth cannot auto-join the staff organization through a pending team invite or gain staff grants after creation.
- Verify link loss/retries return safe metadata and preserve the first accepted organization.

## Task 1: Invitation authority and atomic organization creation

Files: Prisma schema/additive migration; `src/lib/pilot-onboarding.ts`; `src/server/services/pilot-onboarding.ts`; existing organization service; new service tests and disposable database suite.

- [x] Write failing contracts and service tests for staff authorization, issuance/revocation, hash-only storage, generations, version conflicts and credential-free metadata.
- [x] Add the private invitation model, constraints, RLS and restrictive receipt references.
- [x] Inject an optional transaction client into existing organization/role initialization, preserving three-argument callers and existing assertions.
- [x] Implement email-bound status and explicit atomic redemption with same-user retry receipts.
- [x] Prove concurrent redemption, wrong identity, expiry, revocation, no staff escalation and rollback after an initializer failure in disposable PostgreSQL.

## Task 2: Browser session and auth continuation

Files: pilot HTTP/identity helpers; pilot session/status/accept routes; middleware; auth callback/confirm routes and login page; new boundary/auth tests.

- [x] Write failing tests for exact public methods, bounded same-origin fragment exchange, HttpOnly cookie options, no validity oracle, and no credential logging.
- [x] Add sanitized private responses and server-verified identities independent of organization membership.
- [x] Preserve `/pilot` continuation through both login methods and suppress team auto-accept in pilot context.
- [x] Reject external/ambiguous auth continuation paths while preserving ordinary local continuations.
- [x] Verify unauthorized redemption and neighboring routes remain protected; no live sign-in or email requests.

## Task 3: Staff approval and prospect onboarding interfaces

Files: new pilot invitation panel; staff inbox integration; public pilot page/form; fixtures and new browser spec; docs and rollback procedure.

- [x] Write failing UI tests for explicit staff approval, one-time copy, reload/revoke/reissue, edits clearing consent and uncertain outcomes.
- [x] Add a collapsed panel to the staff inbox with no automatic reads/writes; refresh parent entry versions after invitation changes.
- [x] Implement fragment removal/exchange, generic sign-in/unavailable states, confirmed workspace creation and safe continuation.
- [x] Add isolated desktop/mobile browser cases, extend the exact rehearsal selection/count, and retain all existing coverage.
- [x] Run formatter, narrow tests, full unit suite, types, lint, guarded production build and browser rehearsal.
- [x] Complete independent review, regression fixes, rollback, migration compatibility, and reviewed additive DDL.

Release steps: merge/push the tested tree and verify CI/deployment read-only. Record the release evidence privately. Issue no real invitation or test account.

## Execution ledger

- Initializer decision: transaction injection avoids duplicating roles/team creation and preserves existing normal callers. Existing-member pilot onboarding is deferred so no account/default membership is silently changed.
- Credential decision: one-time display plus fragment/cookie exchange uses standard bearer-token hygiene. Lost issuance requires explicit revocation/reissue; no recoverable plaintext is stored.
- Baseline: main `a79d1ce68cec9c6eadf6f8080e4ec1e9f433c14c`; implementation now complete. The copied baseline schema has literal dummy loopback URLs, and SQL was generated offline with an explicit temporary config.

- Approved test corrections: fixed local Supabase callback URLs; endpoint-specific fragment exchange response; empty pilot lookup fixture plus cross-device coverage. All prior assertions retained.
- Auth continuation uses the existing fixed callback URLs and the HttpOnly pilot cookie. For verified users without memberships, invitation existence by normalized email is a routing hint across devices, never redemption authority.
- Regression fixes: revoked staff access clears the parent inbox; conflicting default memberships suppress setup continuation. Browser completion clears the cookie before the actual setup component loads.
- Verification: 1,865 unit tests in 253 files; 8 disposable PostgreSQL cases; 30 isolated browser scenarios, including desktop/mobile completion; lint, strict/fast types, production build. No provider requests or real test records.
- Independent read-only review found no production defects. Its completion-click coverage note was addressed.
- Migration compatibility: one pre-existing synthetic signup remains unchanged; new table starts empty with RLS. Exact Prisma checksum stamp remains one row after two applications.
- Rollback: private reverse patch restores baseline application code while retaining additive schema and durable receipts. No database restore or receipt deletion.
