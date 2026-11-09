# Inbox freshness and offline recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Keep the existing isolated workspace.

**Goal:** Show when the inbox list was last checked and allow read-only recovery without losing local work.

**Architecture:** Reuse `readLoadedPages` so checks retain the current page window, applied filters, mounted drafts, active reviews, and unconfirmed results. Browser connection events are hints: reconnecting never retries an action or marks the list current. Only an authorized, validated, current list response updates its checked time.

**Tech stack:** Existing React/Next.js, TypeScript, Vitest, and Playwright. No dependencies or schema changes.

**Spec:** User request and approved proposal in this chat: freshness, refreshing/offline/failure status, and a read-only Check again control.

## Global constraints

- Preserve drafts, filter edits, reviews, and uncertain results.
- Keep the widget off; no DeepSeek or real email requests.
- Test with mocked external services; no production business-data changes.
- No new dependencies. Retain existing assertions and browser scenarios.

## Review focus

- A response arriving after disconnect must not mark an obsolete list fresh.
- An editor opened or changed during a read must remain mounted and keep its values.
- A successful list check must not resolve an uncertain mutation receipt.
- Account/workspace revocation must clear private data and freshness metadata.
- Offline initial load and reconnect must recover without automatic action replay.

### Task 1: Freshness and connection recovery

**Files:** Add `src/components/follow-ups/inbox-freshness.tsx` and `inbox-freshness.test.tsx`; modify `follow-up-inbox.tsx`.

- [x] Write failing inbox behavior tests covering initial/successful checks, offline/reconnect, failures, drafts, uncertain results, access loss, and delayed responses.
- [x] Observe the failures before changing production code.
- [x] Add a compact accessible status and Check again control; integrate timestamps and connection cancellation into the current page lifecycle.
- [x] Run focused tests and affected existing inbox tests. Correct confirmed failures without weakening assertions.

### Task 2: Browser rehearsal and release

**Files:** Add `e2e/inbox-freshness.spec.ts`; extend existing mocked rehearsal includes/count fixtures; document behavior and limits in `docs/ops/inbox-freshness.md`.

- [x] Add six guarded browser scenarios including desktop/mobile, offline recovery, retained drafts/results, failure, and stale access/response behavior.
- [x] Run all unit tests, lint, build, and full mocked rehearsal. Run strict and fast type checks after builds.
- [x] Request one fresh read-only code review; fix important findings.
Release procedure: merge and push after checks pass, then verify CI, the exact deployed commit, anonymous denials, and widget-off state without provider requests or business-data writes. Record release evidence in the task verification ledger.

**Tradeoff:** This does not persist offline edits across page reloads, synchronize drafts across devices, or queue offline mutations. Those would require a separate storage and conflict policy.
