# Callback to CRM handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for implementation and independent review before merging.

**Goal:** Explicitly preview and approve one CRM callback task per website callback, choosing an existing lead or creating a lead, optionally linked to a matching contact.

**Architecture:** Existing Settings callback cards open a separate handoff component. Read-only options and preview endpoints scope every choice to the current organization; commit recomputes a preview fingerprint and atomically creates the lead/link/task and one durable receipt. A receipt survives callback/CRM deletion so retries never recreate work.

**Tech Stack:** Existing Next.js, React, Zod, Prisma and PostgreSQL; no dependency changes.

**Spec:** User-approved description in this chat: match an existing lead/contact or create a lead, choose owner/deadline, preview and explicitly approve task creation, prevent duplicate conversion and link back to request.

## Global constraints

- Mocks only. Never retrieve/decrypt/use the saved DeepSeek key or call AI/Twilio. No automatic contact, messaging, lead conversion, publication or widget activation.
- Preserve all existing tests. Ask before changing any preexisting test expectations or dependencies. Preserve unrelated untracked files.
- Admin settings plus fresh membership and leads:read/leads:write/contacts:read required. Validate assignee membership, selected active lead, matching contact and open pipeline stage within the same org.
- Standard transaction + idempotency receipt prior art. Existing CRM creators have asynchronous assignment and separate commits, so this path uses a focused atomic transaction, chosen owner and fixed MEDIUM task priority; it changes no existing CRM creator behavior.
- Phone matching uses normalized international digits, never fuzzy names or inferred country codes. Show multiple matches and require selection. New leads need explicit duplicate acknowledgement if matches exist or results are truncated.
- Callback status remains independent of handoff. Existing lead/contact details and owners are never overwritten. New lead owner equals chosen task assignee. Source details are copied only after explicit preview/approval; deleting source does not delete CRM work.

## Review focus

1. Concurrent confirm, lost response and source deletion must yield at most one task/lead; receipt outlives source/CRM deletion.
2. A removed member, foreign/deleted/closed lead, foreign contact/stage/assignee or guessed ID cannot authorize handoff.
3. Changed callback, matching records, choices or draft invalidate preview; edited UI fields clear approval.
4. Name/phone/reason are untrusted plain text; errors never reveal SQL/provider/credentials; stale/failed requests preserve inputs.
5. Contact-only matches require an explicitly created linked lead because Task.leadId is required; no silent duplicate selection or synthetic name creation.

## Tasks

- [x] Root: Add strict shared options/draft/preview/receipt DTOs and contract tests. Freeze API interfaces for workers.
- [x] Backend: Add server-only receipt model/migration, scoped options and deterministic preview/atomic commit services. Write new unit and disposable PostgreSQL tests first; prove rollback, tenant isolation, permission/membership changes, stale previews, normalized/ambiguous matches, contact links, concurrent confirm, deleted targets and no automatic side effects.
- [x] UI: Add new handoff component/tests and one small callback-card insertion. Explicit load, manual target choice, owner/deadline, review, confirmation, links; invalidation on edits; no mount reads or live AI. Add new mocked desktop/mobile browser tests.
- [x] Root: Add bounded authenticated HTTP routes/tests; safe same-origin behavior, session identity only. Review implementation with a fresh reviewer.
- [ ] Verify: npm test, npm run lint -- --fix, npx tsc --noEmit, npm run typecheck:fast -- --incremental false, npx prisma validate, npm run build, disposable PG and mocked browser suites. Do not overlap TS checks with build or multiple Playwright output runs.
- [ ] Release: capture read-only before-state and test code rollback preserving additive schema/migration; apply migration only after green checks, commit/merge/push within session authorization, verify CI/deployment and production mocked/read-only smoke. Never create real CRM records to verify production.

## Implementation rulings

- Implemented inline on the feature branch, preserving the current checkout and unrelated untracked files. A fresh reviewer independently checked backend and UI/API boundaries.
- Added an explicit receipt-backed task source endpoint/component after review found that descriptions render URLs as plain text. Source landing loads only on a user click, without providers or writes.
- Matching is checked at preview and confirmation time; it is not a global unique-phone constraint. Unrelated CRM edits can occur after that check. The permanent receipt guarantees at most one handoff per callback.
- Fresh permission checks use the existing app semantics; actor/assignee memberships and selected destination organization identity remain locked through the write.

## Tradeoffs

Receipts are snapshots without foreign keys to source/lead/task, retaining idempotency through deletion. UI links indicate deleted targets are unavailable. This makes intentional repeat handoffs harder: use normal CRM task creation/reassignment after the first handoff. No bulk conversion, arbitrary CRM search, fuzzy phone matching, automatic calling, or new pipeline creation in this release; an open stage must already exist for new leads.
