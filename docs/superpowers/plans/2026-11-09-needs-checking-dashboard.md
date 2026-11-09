# Needs checking dashboard implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Surface authorized uncertain email sends on the dashboard and open the matching inbox tab without changing drafts or retry guards.

**Architecture:** A small client card reads the existing scoped aggregate endpoint. Reuse the count hook and strict count schema, including private Needs checking access validation. Totals cover all four inbox tabs; per-tab links identify matching destinations. Inbox entry links reuse existing retained-filter navigation and draft confirmation.

**Tech stack:** Existing Next/React, Zod, Vitest, Playwright. No dependencies or migration.

**Spec:** The user approved the summary described in chat: authorized count, freshness, filtered inbox links, visible stale/offline/error states, drafts and blocked retries preserved. Routine design choice: show a total plus matching-tab links so Approved, Dismissed and Snoozed sends are not hidden behind a Pending-only destination.

## Constraints

- No DeepSeek, live provider calls, real email, widget activation, new dependencies or production business-data writes.
- Keep all existing test assertions, browser scenarios, transport guards and send-result guards.
- Scope counts to the authenticated workspace/user and current send access. Stale identity clears private counts, never shows zero.
- Only GET count reads; no per-card checks or automatic send retries. Offline recovery requires explicit refresh.
- A summary link applies only Needs checking and its selected tab. Same-tab incoming links retain existing filter edits and mounted drafts; cross-tab links use existing navigation confirmation. Invalid/repeated link parameters do not activate a private filter.
- Rollback: normal code revert; no persisted state is added or changed.

## Review focus

- Missing Needs checking HTTP query support must not make a failure look like zero.
- Malformed, wrong-filter, stale-user and canWrite=false receipts never display private totals.
- Offline, focus return and age mark stale data visibly; reconnect cannot replay requests.
- Dashboard parameter changes cannot unmount dirty editors or unlock blocked retries.
- Dashboard permission checks and existing navigation/workflow remain intact.

## Task 1: Count contract, summary and dashboard placement

Files: counts route/tests; existing count hook/tests; new dashboard needs-checking-summary.tsx/tests; dashboard page/access tests.

- [x] Add RED route regression for needsChecking=1, invalid/repeated values and existing scope/no-store behavior. Fix allowed query and require explicit send-status opt-in for filtered reads.
- [x] Add RED count-hook coverage for opt-in header and canWrite=false rejection under Needs checking, retaining ordinary read-only counts.
- [x] Add RED card tests for total/tab URLs, zero, scoped errors, identity change, offline/explicit refresh and stale focus/age. Implement the component with existing styles above dashboard tabs; mount only for leads read/write users.
- [x] Run narrow route, hook, component and dashboard permission tests; expect all passing.

## Task 2: Filtered inbox entry and mocked release verification

Files: new shared summary-entry helper/tests; follow-ups page, inbox and navigation tests; rehearsal dashboard/follow-ups fixtures; six new browser scenarios; rehearsal required total274→280.

- [x] Add RED entry parsing/page and incoming navigation tests. Strictly parse needsChecking=1 and valid single tab, initialize the first read with the filter, and reuse retained navigation for later prop changes. Keep existing context keys.
- [x] Add six guarded browser scenarios: desktop/mobile dashboard-to-inbox keyboard flow, zero/error retry, offline no replay, stale identity, and mounted blocked draft preservation for incoming links.
- [x] Run narrow tests and then all required checks: npm test, npm run lint, npm run build, npx tsc --noEmit and npm run typecheck:fast after build, npm run test:receptionist:mocked. Use dummy environment and network guards.
- [ ] One fresh whole-branch review, fix confirmed issues with regressions; prepare revert evidence. Merge/push under existing authorization, verify all CI jobs, exact production SHA, anonymous denial and widget-off state. No authenticated production writes.

What this makes harder later: counts remain point-in-time snapshots. Provider delivery reconciliation and manual resolution of uncertain sends remain separate work.
