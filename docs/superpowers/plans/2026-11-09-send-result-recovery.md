# Send-result recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline, then obtain one fresh whole-branch review.

**Goal:** Recover follow-up email send results without issuing a duplicate delivery.

**Architecture:** A private per-follow-up database record reserves each explicit attempt before transport. It becomes dispatching immediately before the provider send call, confirmed when provider acceptance is persisted, or failed only when dispatch never started. Reads never call a provider. Unknown and confirmed attempts permanently block further delivery for that follow-up, including from legacy clients and other tabs.

**Tech stack:** Existing Next.js, Prisma/PostgreSQL, React, Zod, Node crypto, Vitest and Playwright. No dependencies.

**Spec:** User-approved description in chat, expanded in this plan. Scope is follow-up emails; general lead composers, previews and cadences retain existing behavior.

## Global constraints

- No new dependencies, live AI, real email, widget activation, or production business-data tests.
- Preserve drafts, edits, uncertain results, existing assertions and every browser/network guard.
- Provider acceptance is not inbox delivery. A failed status proves only that the final send call was never started.
- Store no subject, body, recipient or attachment bytes in the ledger. Bind payloads with a domain-separated HMAC including attachment digests.
- Keep the private table and operation evidence during rollback; pause follow-up/manual writes in the rollback runtime rather than restoring an unprotected sender.
- Only current assigned actors with lead read/write permission can read results. Changed actors cannot see previous mailbox IDs, but cannot erase duplicate protection.

## Review focus

- Crash between reservation and dispatch must block rather than assume failure.
- Database failures after provider acceptance must not issue another provider call.
- Membership removal/re-addition or reassignment must not delete attempt evidence.
- Delayed reads, offline events and stale account responses must preserve edits and never unlock sending without a fresh valid check.
- Old clients without operation IDs must still receive server-side duplicate protection.

## Task 1: Reserve and finalize delivery attempts

Files: new `src/lib/email-send-result.ts`, `src/server/services/email-send-results.ts`, service tests; modify Prisma schema, additive migration, email and Microsoft transport hooks.

Interface: `trackFollowUpSend(org,user,id,input,attachments,deliver)` returns the exact confirmed provider result; `readFollowUpSendResult(org,user,id)` returns scoped NONE/UNKNOWN/CONFIRMED/FAILED metadata. Deliver receives `beforeDelivery()` and `accepted(result)` hooks. A follow-up lock serializes reservations; transition updates match operation and actor. No expired lease or automatic retry.

- [x] Write failing service and transport tests covering exact replay, concurrent/different IDs, changed payloads, lost responses, pre-dispatch failures, post-dispatch uncertainty, acceptance followed by CRM failure, denied access and reassignment privacy.
- [x] Verify the expected missing behavior, implement, and run narrow tests.

## Task 2: Protect HTTP sends and expose read-only status

Files: email send route, new follow-up send-result GET route and tests; capability negotiation in existing list/client/page helpers.

- [x] Write failing route tests for anonymous/stale-context/query denial and no-store reads. Extend existing send fixtures without removing assertions.
- [x] Route every follow-up send through tracking, including legacy requests; bind JSON and multipart content. Retain general composer behavior.
- [x] Negotiate sendResults on every loaded page; test mixed/old backend responses.

## Task 3: Recover results in the composer

Files: new `src/components/email/send-result-recovery.tsx` and tests, EmailCompose, inbox/card wiring; six browser scenarios.

- [x] Write failing UI tests for read-only initial checks, lost confirmation, reload, duplicate tabs, failed reads, offline/reconnect, changed actors and intact unsent edits.
- [x] Block sending while checking, unknown or confirmed. Explicit Send only after NONE or FAILED; operation IDs are fresh per explicit attempt. Check status is always a read and never resends or clears a draft. Ignore stale responses.
- [x] Retain every existing rehearsal scenario and add six guarded browser scenarios, desktop/mobile coverage and keyboard checks.

## Task 4: Prove isolation, rollback and release

Files: synthetic runner and integration suite, required CI job, anonymous production smoke list, operations/rollback documentation.

- [x] Run real PostgreSQL synthetic concurrency and constraint/RLS tests inside the existing owned disposable runner with mocked delivery. Assert CRM records unchanged and no provider/network violations.
- [x] Capture read-only release/catalog baseline; test a rollback runtime that retains schema/ledger but pauses follow-up writes. Park its exact patch and proof.
- [x] Run full unit, lint, build, strict and fast types after builds, all mocked browser scenarios, existing performance/private-draft drills and new send drill; obtain fresh review and fix confirmed issues.
Release procedure: merge/push under existing authorization, verify all CI jobs, exact production commit and anonymous denials; read-only catalog confirms RLS/no client grants and widget off. Record the result in the verification ledger.

What this makes harder later: a deliberate second email requires a new follow-up. Unknown outcomes cannot be reset automatically; provider reconciliation and manual resolution are deferred.
