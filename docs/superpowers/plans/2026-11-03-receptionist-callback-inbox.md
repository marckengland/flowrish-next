# Receptionist callback inbox implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline, with one independent whole-branch review before merge.

**Goal:** Give administrators a dedicated `/receptionist/callbacks` page for confirmed requests, status filters, and existing approved CRM handoffs.

**Architecture:** Add a callback-only view to the existing `WebsiteReceptionistSettings` component, so Settings and the inbox share the exact same controls and request lifecycle. Guard the server page with fresh current-organization membership and Settings permission. Reuse existing session-scoped callback and handoff APIs without changes.

**Tech Stack:** Existing Next.js 15, React 19, Tailwind and UI components, Zod, Vitest and Playwright; no new dependencies.

**Spec:** The user-approved chat description: a dedicated inbox to review pending requests, filter pending/reviewed/dismissed, open linked leads/tasks, and preserve existing previews and confirmation. Continue the session's mocks-only and merge/deployment authorization. Never read/decrypt/use the real DeepSeek key or place calls.

## Global constraints

- Baseline `0de2e19598efd3389aab21b8523baedfd164f972`; work on `codex/receptionist-callback-inbox` in the existing checkout. Preserve `.serena/` and `.spec-workflow/`.
- No schema, dependencies, provider settings, background jobs, new mutations, automatic handoff, or new AI/Twilio/website calls. No existing tests edited without approval.
- Inbox loads callback records only after **Load callback requests**. Existing twenty-row pagination, status changes, delete confirmation, handoff preview/approval, receipt links, and outcome controls remain shared.
- Inbox hides all configuration/readiness/spending/embed controls. Existing default and setup-only views retain their behavior.
- Current Settings permission is required to mount the inbox. CRM handoff retains its existing additional CRM and contacts permissions; CRM staff without Settings use their assigned callback work queue.
- Use existing Flowrish spacing, typography, colors, focus styles, minimum 44px controls, responsive layout and dark theme. No new design system.

Sharing the panel keeps Settings and the inbox behavior coupled; independent inbox interaction changes would require a later extraction. This is preferable to duplicating approval code or broadly refactoring working controls.

## Review focus

- Foreign/stale session roles, removed membership and database failures must not mount an unauthorized inbox or expose callback details.
- Opening the inbox must neither load configuration nor spend provider credits; page reads and filters never create CRM records or bypass approval.
- Default/settings-only modes and all existing tests must retain their original behavior and request ordering.
- Filters/pagination must label the loaded snapshot, errors must hide private diagnostics, and late requests must be aborted on unmount.
- Existing handoff receipts, explicit confirmation and permanent-delete confirmation must remain usable on mobile and desktop.

## Tasks

### 1. Shared callback-only view

**Files:** `src/components/settings/website-receptionist-settings.tsx`; new `src/components/receptionist/callback-inbox.test.tsx`.

- [x] Add failing real-component tests for callback-only controls, explicit loading/filtering/pagination, safe errors/unmount, delete confirmation, and confirmed handoff receipt links.
- [x] Run the new tests and observe failure because configuration controls are still visible.
- [x] Add optional `callbacksOnly?: boolean` (default false). Hide the configuration Card in that mode, label the outer section as the inbox, and reuse the existing callback Card unchanged.
- [x] Run the new tests and existing website settings/handoff/outcome suites. Preserve all existing assertions.

### 2. Fresh administrator page gate

**Files:** new `src/app/(dashboard)/receptionist/callbacks/page.tsx` and `page.test.tsx`.

- [x] Add failing page tests: fresh local Settings allows access despite stale session, CRM-only/foreign-only/removed membership deny before mounting, auth and genuine database errors propagate.
- [x] Implement `ReceptionistCallbacksPage()` with `requireSession`, `callbackAccess`, an admin-only gate, organization/user key, home link and shared callback-only component.
- [x] Verify the page tests and TypeScript.

### 3. Navigation

**Files:** `src/components/receptionist/receptionist-home.tsx`, `src/components/settings/receptionist-settings.tsx`, `src/components/layout/header.tsx`; new `src/components/receptionist/callback-inbox-navigation.test.tsx`.

- [x] Add failing tests for the administrator home link to `/receptionist/callbacks`, its absence for staff, and a distinct header title.
- [x] Point the existing home review link at the inbox; add a Settings inbox link; order the header prefix before `/receptionist`.
- [x] Run focused tests and the full unit suite, lint autofix, strict/fast types, Prisma validation and production build.

### 4. Verify and release

**Files:** new `e2e/receptionist-callback-inbox.spec.ts`, docs `docs/WEBSITE_RECEPTIONIST.md` and this execution record.

- [x] Mock all provider, website and business mutation traffic. Check desktop light/mobile dark inbox navigation, filters, empty/errors, pagination, delete confirmation, handoff preview/approval and CRM links; verify read-only real GET/auth validation separately.
- [x] Run existing disposable PostgreSQL website/handoff/outcome suites and relevant mocked browser regressions.
- [x] Independent staged whole-branch review, fix material findings with regression coverage, and prove reverse staged diff restores the exact baseline tree.
- [ ] Commit/merge under session authorization, verify merged tests, push, check CI/deployment and production with mocked business writes and read-only counts. A normal merge revert is sufficient; no persistent data/configuration change requires rollback.

## Execution record

Baseline: 1,625 tests in 205 files passed. No task product changes yet. Live providers and production business writes remain prohibited.

- Task 1: shared callback-only view verified RED → GREEN. The existing callback controls and their handlers are unchanged. Focused shared/page/navigation/settings/handoff/outcome run passed 48 tests; no existing test files were edited.
- Task 2: fresh local administrator gate verified with six page tests covering stale/foreign/CRM-only roles, removed membership, authentication and genuine database failures. Denied requests never mount the inbox or fetch callback details.
- Task 3: administrator home and Settings entry plus distinct breadcrumb implemented. Full unit suite passed 1,640 tests in 208 files; strict and fast types, repository ESLint autofix, Prisma validation and optimized production build passed. Prisma's existing configuration deprecation warning remains.
- Task 4: disposable PostgreSQL website 20, handoff 13 and outcome 14 tests passed. New browser run passed four checks including auth setup; existing Settings/setup/home/handoff/outcome run passed thirteen including auth setup. Desktop light and 390px mobile dark screenshots inspected, with no horizontal overflow.
- The initial new browser test timed out at its exact `getByLabel('Callback status')` selector; the trace showed the select present. Its locator was corrected to the existing browser suites' accessible combobox query, retaining all assertions. The interrupted run was not considered verified; the full rerun passed.
- Independent whole-branch review found no Critical, Important or Minor issues and separately passed all fifteen new focused unit tests. No product changes followed review.
- Local build/server blocked live AI/Twilio fetch transports and native website HTTPS. No blocked-attempt log was produced; every business mutation in browser tests was mocked. Read-only production baseline: callbacks, handoffs, outcomes and enabled widgets all zero.
- Reverse staged diff restores the exact baseline tree in a temporary Git index. Rollback is a normal `git revert -m 1 <inbox-merge>` and deployment; no database/configuration rollback is needed. CI/deployment and production verification follow the authorized push.

Not performed: real provider/website/call requests, saved-key retrieval/decryption, widget activation, or production test-record creation. Inbox and Settings intentionally share callback behavior; configuration remains outside the inbox.
