# Follow-up send status implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, then one fresh whole-branch review.

**Goal:** Show saved send status on compact follow-up cards and filter all accessible pages to Needs checking without losing drafts or unlocking retries.

**Architecture:** Reuse the private send ledger. Lists batch-read minimal state metadata after authorization. A shared SQL EXISTS predicate applies Needs checking before pagination and counts; cursor bindings include the filter. Card checks call the existing read-only status endpoint. Composer guards remain independent of card badges.

**Tech stack:** Existing React/Next.js, Prisma/PostgreSQL, Zod, Vitest and Playwright. No dependencies or migration.

**Spec:** User-approved chat description, expanded here. EMAIL cards show Provider accepted, Needs checking or Send did not start for recorded attempts. No-attempt cards have no badge. Needs checking means PREPARING/DISPATCHING, or a record owned by a different actor whose receipt must remain hidden. CONFIRMED/UNKNOWN never enable a retry through the card. Checks do not send, regenerate, alter task state or clear drafts.

## Constraints

- No new dependencies, widget activation, DeepSeek, real email or production business-data tests.
- Retain every existing test assertion, browser scenario and network/write guard.
- Only current assigned users with lead read/write access may see send metadata. List payloads omit operation IDs, provider IDs, request hashes and mail content.
- Read-only users receive no badges and cannot filter private send states. Stale permissions fail closed.
- Batch metadata once per page, never one request per card on mount.
- Needs checking composes with search, source, tabs, task progress/order, counts and saved views. Keep authorized open/dirty/uncertain cards independently of filters and page position.
- Changing only Needs checking uses retained-page refresh and preserves exact mounted editors. Other filter changes keep existing review/discard protections.
- Old clients and unadvertised backends keep their prior behavior. Filtering fails visibly when support is absent.

## Review focus

- Mixed-page capability changes and revoked write permission cannot reveal or silently broaden private results.
- Old cursors cannot be reused under a changed Needs checking filter.
- Delayed list/status reads cannot downgrade a locally unknown or confirmed send or replace typed edits.
- An explicit badge check never passes permission to the composer or unlocks its blocked retry.
- Saved views containing the new optional filter remain readable during rollback.

## Task 1: Shared filter and safe metadata

Files: new `src/lib/follow-up-send-status.ts`, service helper/tests; existing filters, eligibility/filter SQL, cursor, counts and list services/tests.

- [x] Write RED tests for query parsing/serialization/saved-view round trips, cursor fences, shared pre-LIMIT and counts predicate, batched minimal metadata and revoked-access denial.
- [x] Implement optional `needsChecking`, opt-in list state metadata, scoped batch selection and final write-access check; run narrow tests.

## Task 2: HTTP and page negotiation

Files: list route, HTTP/client helpers, page reader and tests.

- [x] Write RED opt-in/invalid-filter/private-read tests and mixed-page support cases.
- [x] Add `x-flowrish-send-status: 1` and `sendStatus` capability. Legacy list signatures remain unchanged unless opted in. Reject filtered reads without support and validate every advertised EMAIL metadata item.

## Task 3: Card badges and preserved navigation

Files: new card status component/tests; inbox/composer wiring, filter controls, six browser scenarios.

- [x] Write RED tests for compact labels, read-only check/retry, stale actor/offline/delayed responses, no automatic per-card calls, intact drafts and blocked composer retries.
- [x] Show scalar state only. Composer sends/checks update the badge but badge checks never update the composer's send permission. Preserve local uncertain state across list polling.
- [x] Keep Needs checking toggles and clear-only changes within retained refresh; include active summary/unapplied changes and saved-view round trips. Add six browser scenarios while retaining all existing scenarios and guards.

## Task 4: Database and release verification

- [x] Extend the existing send-result synthetic drill with actual paged filter/count/cursor/retained-draft/private-access checks; retain all three existing checks. Run existing performance/private-draft drills.
- [x] Prepare and test a code rollback that retains additive filter parsing/query compatibility for saved views and all existing send guards; do not remove or reset ledger data.
- [x] Run full unit, lint, build, strict/fast types after builds, all mocked browser scenarios and required database suites. Obtain one fresh review and fix confirmed issues.

Release procedure: merge/push under existing authorization, verify CI and exact production release, anonymous denials and widget-off catalog state. No authenticated production product writes.

What this makes harder later: a card check shows Flowrish's saved acceptance only. Provider reconciliation, bounce tracking and manual unknown-result resolution remain separate work.
