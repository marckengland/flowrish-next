# Saved lead views implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline and one fresh whole-branch review.

**Goal:** Save, apply, update, rename and delete personal lead-filter views per workspace/user, available across devices.

**Architecture:** An additive `SavedLeadView` table belongs to an OrganizationMember through its user/workspace composite key. Private API routes derive both identities from the authenticated session and check current membership and `leads:read`. Strict bounded filter validation, scoped reference checks, per-member write locking, unique names, idempotent creation and optimistic revisions protect writes. A small client control reuses the existing filters and lead query; views cannot grant access to records.

**Tech stack:** Existing Prisma/PostgreSQL, Next.js, React, Zustand, Zod, Vitest and Playwright. No new dependencies.

**Spec:** The user's approved saved-view proposal and request: personal workspace/user views, cross-device sync, mocked verification, fix issues and merge; no dependencies, widget activation or DeepSeek. Existing 64 browser scenarios and all guards must remain; user approved six additional scenarios and a required total of 70.

## Global constraints

- Use the managed worktree and `codex/saved-lead-views`; preserve unrelated source-checkout `.serena/` and `.spec-workflow/`.
- No real AI/provider requests, credentials in files/logs, customer leads/tasks/emails, or widget changes. Production DDL is reviewed migrations only. Never `prisma db push`.
- Existing tests retain assertions; ask before correcting a mistaken test. Use configured checks; strict/fast types follow the Next build.
- Personal filters only; sharing, sort/column layouts, default-view selection and push notifications are deferred. Cross-device reads refresh on page focus and explicit refresh; edits are never applied automatically.

## Review focus

- Cross-user/workspace IDs and membership revocation: scoped queries, membership FK and server-only table privileges prevent disclosure or writes.
- Concurrent devices: stale revisions cannot overwrite/delete new changes; uncertain creates reuse their ID and do not duplicate rows.
- Deleted stages/assignees: reject applying unavailable filters without silently broadening the current lead list.
- Hydration, pending search debounce and workspace switching: applying a view cannot resurrect old searches; late reads/writes cannot populate another scope.
- Offline/API failures and keyboard/mobile use: preserve current filters and drafts, expose recoverable errors, no implicit mutations or AI calls.

## Task 1: Persistence and private API

- [x] Add schema/service/route tests for strict values, scopes, current access, reference validation, cap20, idempotency, name conflicts, stale revisions, safe errors, origin/body limits and no-store responses. Run narrow tests and observe missing implementation fail.
- [x] Add the model and reviewed migration (RLS enabled, browser-role privileges revoked, membership cascade, bounded name/filter/revision constraints). Generate the client with explicit dummy datasource configuration and implement service plus GET/POST/PATCH/DELETE routes.
- [x] Run narrow tests green. Verify migration/constraints/rollback on an owned disposable cached PostgreSQL container using offline SQL and no root datasource.

## Task 2: Lead-page control

- [x] Add UI regressions before implementation: list/apply/create/update/rename/delete, refresh across mounts/devices, failures and stale versions, missing references, scope changes, debounce and keyboard labels.
- [x] Add a client view control and scope-specific filter persistence. Integrate on `/leads`, retaining existing lead RBAC and pagination behavior. Refresh view metadata on focus without changing live filters.
- [x] Run narrow UI tests plus existing lead filter/table regressions.

## Task 3: Full mocked verification and integration

- [x] Add six isolated browser scenarios and approved fixtures; require all70 with zero skipped/retried scenarios and no guard violations.
- [x] Run `npm test`, lint, build, strict and fast types, and mocked rehearsal. Get one fresh whole-branch review and fix material findings with regressions.
- [x] Write usage/rollback notes; prove the code inverse against baseline `3d1207135731fd7ff0004523db92b5b4941b6f08`. Reverting code leaves the additive table and saved preferences intact; never drop user views as an automatic rollback.
- [ ] Commit, merge to main, test merged tree, push under session authorization, verify CI, the new migration, release gate/live smoke and zero enabled widgets. Remove only owned worktree/branch/scratch resources after integration.

This approach makes team sharing a separate permissions feature later; personal views must never be made public by relaxing the current ownership checks.
