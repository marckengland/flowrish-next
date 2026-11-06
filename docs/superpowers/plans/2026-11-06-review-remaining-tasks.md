# Review Remaining Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, task by task, followed by one fresh whole-change review.

**Goal:** Start a fresh reviewed batch from the failed or unattempted open tasks in saved history while preserving inbox drafts and filters.

**Architecture:** A bounded GET review endpoint resolves selected batch ordinals on the server, rechecks exact audit results and current access, and returns current task previews. The browser creates a separate batch only after explicit confirmation, reusing existing registration, execution and exact-receipt checks. Still-uncertain, successful, completed and inaccessible tasks remain excluded.

**Tech Stack:** Existing Next/React, Zod, Prisma, Vitest, Playwright. No dependencies or migrations.

**Spec:** User-approved in-chat recommendation immediately before “go”. Failed/unattempted selection; check uncertain results first; fresh details/review/confirmation; preserve filters/drafts; mocks only; widget off; no DeepSeek/emails.

## Global constraints

No new dependencies, provider calls, real emails, public widget activation or production task/lead test writes. Preserve every existing assertion and browser/network guard. Existing history reads stay read-only. A missing audit receipt never makes an uncertain attempt eligible. Exact task versions guard concurrent original requests and new confirmations.

## Task 1: Server review contract

- [ ] Write schema, service and route regressions and observe them fail.
- [ ] Add a strict max-20 unique-index GET contract. Recheck owner/membership/write/lead/task access, original exact outcomes, current task identity and completion; no writes. Invalid targets fail before previews.
- [ ] Recheck history after previews and exclude newly confirmed/uncertain/inaccessible entries; never replay original request IDs.
- [ ] Run narrow tests. Expected: all new cases and existing history/task tests pass.

Interfaces: optional canReview on detail (absent means false); GET /api/follow-ups/batches/[id]/review?index=… plus an explicit new deadline/timezone for rescheduling; strict ready/skipped DTO without hidden source metadata for excluded rows.

## Task 2: Browser review and explicit new batch

- [ ] Write UI/helper regressions, observe failure, then implement selection, explicit new deadline, current preview, confirmation, retained outcomes and GET-only verification.
- [ ] Reuse task batch registration and sequential task helpers with fresh IDs. Lost saving receipt means zero task requests. No automatic submission or resumption.
- [ ] Connect existing inbox busy protection without navigation/filter changes; disable competing actions while requests run. Keep review/results mounted and redact on current access loss.
- [ ] Add six guarded browser scenarios; raise 202 to 208, retaining all 202.

Expected: drafts remain the same DOM nodes with unchanged values; active filters stay applied; old successes/uncertain entries are excluded; original task URLs/bodies remain compatible.

## Task 3: Verify and release

- [ ] Run synthetic PG17 drill with current schema, actual services and disposable data. Check exact proof, stale versions, partial results, ownership/access and zero review writes.
- [ ] Run npm test, lint, build, mocked rehearsal; strict and fast types after both Next builds finish.
- [ ] Fresh whole-change review; fix important findings test-first with one complete verification pass.
- [ ] Test exact inverse/reapply in temporary index; application revert leaves existing task and audit records unchanged. Archive owned evidence before removing only this workspace.
- [ ] Commit, fast-forward main, push, verify all five CI jobs, exact deployment/alias, anonymous API denial (including review endpoint), catalog 43 migrations / 0 enabled widgets.

## Tradeoffs and exclusions

An uncertain request without a definitive result cannot be safely retried here. This makes abandoned uncertain requests harder to recover, but avoids repeating an in-flight change. Existing history remains immutable; recovered work appears in a separate new batch. No retroactive grouping, automatic retries, persistent unfinished reviews, or unrelated navigation changes.

## Review focus

Check original requests still in flight, post-preview exact status changes, changed/relinked/completed tasks, missing/current permissions, selected ordinal/preview mismatches, stale account/deferred responses, save acknowledgment loss, fresh IDs and versions, competing inbox actions, and drafts/filter preservation. No path may submit a task without a new explicit review/confirmation.
