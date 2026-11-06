# Follow-up Bulk Actions Menu Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-change reviewer after implementation.

**Goal:** Replace competing idle bulk forms with one Bulk actions chooser while preserving drafts, active reviews, edited deadlines and uncertain results.

**Architecture:** Keep the existing action components and request contracts. A native select chooses an available action. Stable mounted wrappers hide idle panels and keep retained work visible even after the menu changes. Existing retention hooks pin completion, deadline and approval reviews; snooze reports local retained work and provides explicit clearing. No backend, schema or dependency changes.

**Tech Stack:** Existing React/Next, native select, existing components/tokens, Vitest and guarded Playwright rehearsal.

**Spec:** User request following the in-chat recommendation: one menu, relevant selection actions, preserve drafts/reviews/uncertain results; finish, fix, test with mocks and merge if needed. Widget off; no DeepSeek, real emails or new dependencies.

## Constraints

Preserve all assertions, mutation paths, exact receipt checks, identity/permission fences, busy protection and explicit confirmations. Menu changes perform no reads or writes. Hidden action components remain mounted. Active work can disappear only on explicit clear/cancel, confirmed navigation/discard, or access loss. Keep unrelated .serena/ and original-main .spec-workflow/ changes.

## Task 1: Menu and retention

- [ ] Write failing UI regressions for idle density, contextual actions, menu changes preserving original draft nodes, deadline targets, approval edits, and uncertain results.
- [ ] Implement a native Bulk actions chooser and stable panel wrappers. Move bulk work below status tabs. Show relevant action selection controls/counts; pin active work with existing holds and an additive snooze callback.
- [ ] Add explicit snooze work clearing. Protect navigation from retained snooze/approval work and retain current access/busy safeguards.
- [ ] Expected: new narrow tests pass; no network or mutations from menu operations.

## Task 2: Existing coverage and browser proof

- [ ] Update existing harness interactions to choose the new menu before exercising the same workflows, keeping all assertions and network/write guards.
- [ ] Add six mocked browser scenarios (208→214) for desktop/mobile density and drafts, retained reviews/targets/uncertain results, explicit clearing, read-only/revoked state and keyboard/busy safety.
- [ ] Expected: all prior 208 plus six new scenarios pass with no guard violations. Capture desktop/mobile images.

## Task 3: Verify and release

- [ ] Run npm test, lint, build, guarded browser rehearsal; strict and fast types after both Next builds finish.
- [ ] Fresh whole-change review; fix Important findings test-first in one pass and run complete checks.
- [ ] Prove exact inverse/reapply of staged diff with a temporary index; application rollback keeps task/batch/audit records. Archive owned evidence, then remove only this plan's scratch workspace after fixes are committed.
- [ ] Commit, fast-forward main, push; verify five CI jobs, exact deployment SHA/alias, anonymous API denials and widget off.

## Tradeoffs and exclusions

Keeping idle forms mounted retains component state and avoids clearing another action's busy lock. It uses slightly more mounted DOM than rendering only the chosen form. Separate selections and confirmation flows remain intact; no unified batch execution, new server APIs, migrations or live provider tests. A new database drill is unnecessary because no database/service logic changes; existing guarded workflow coverage remains required.

## Review focus

Inspect stable keys/mounting across menu changes, local approval edits and snooze/deadline targets, uncertain receipts/results, selection relevance/counts, permission changes, busy ownership, pending navigation/discard, native keyboard/focus, hidden form accessibility, and zero unexpected network/mutation activity.
