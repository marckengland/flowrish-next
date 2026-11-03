# Receptionist demo implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Add an interactive, clearly labelled receptionist demo that spends no AI credits and creates no real callback or CRM records.

**Architecture:** A guarded `/receptionist/demo` server page reads the current organization's saved business profile and a bounded excerpt from current, approved public services/pricing documents. A client component uses deterministic replies and an in-memory reducer for conversations, callback correction/consent, handoff approval, and callback outcomes. No demo API, database writes, provider credentials, storage persistence, widget changes, or dependencies.

**Tech stack:** Existing Next.js, React, TypeScript, Zod, Prisma read queries, Tailwind, Vitest, and Playwright.

**Spec:** The accepted chat proposal: practice services/hours/pricing and unknown answers, correct and confirm fictional callback details, simulate CRM handoff and outcomes, label all responses as prewritten demos. The user requires the widget to remain off and forbids use of the real DeepSeek key.

## Decisions

- Reuse fresh current-organization Settings OR CRM access via `callbackAccess`. Never infer organization from client input. Read only saved business fields and approved published knowledge; exclude private notes, drafts, revoked/stale publications, AI settings, and keys.
- Use existing Flowrish neutral panels, typography, green actions, labelled native form controls, mobile layouts, and keyboard focus styles. Add a Demo mode tool link to Receptionist home.
- Typed messages select deterministic services, hours, pricing, callback, or unknown responses. Replies quote bounded approved text without interpreting instructions or rendering HTML. Missing information offers a simulated callback. Clearly disclose that this does not evaluate AI quality.
- Keep all transcript/form/receipt/outcome state in memory. Require review and fresh consent after edits; simulated CRM creation and outcomes have separate preview/approval actions. Reducer guards make repeated confirmations harmless. Reset clears all state. Bound user input and transcript size. Never call live preview, callbacks, handoff, outcome, launch, AI, or voice endpoints.
- Use fictional callback fields, clearly mark the lead/task and outcome history as simulated, and give no working links to real CRM records. Do not infer appointments or guaranteed callback times.
- Work in the current checkout on a `codex/` branch, following this session's established workflow. Preserve `.serena/` and `.spec-workflow/`. Implement inline with one fresh whole-branch review at the end. Existing session authorization covers commit/merge/push; no additional approval is inferred for tests or dependencies.

Tradeoff: deterministic replies exercise the workflow but cannot establish live AI response quality. Adding new demo topics later requires explicit reply rules.

## Task 1: Read boundary and conversation state

**Files:** New `src/server/services/receptionist-demo.ts`, `src/lib/receptionist-demo.ts`, and matching new tests.

**Interfaces:** `DemoBusiness` contains the display name, saved callback-hours label, and optional approved services/pricing excerpts. `createDemoState(business)` and `reduceDemo(state, action, business)` own bounded conversation, corrected callback review, separate handoff approval, and outcome history. `getReceptionistDemoBusiness(organizationId, userId)` authorizes before querying and returns only `DemoBusiness`.

- [x] Write failing tests for local/foreign access, approved-only bounded excerpts, missing business data, literal text, hours/pricing/unknown responses, fresh consent after edits, duplicate confirmation, handoff approval, reached/no-answer/retry outcomes, reset, and bounds.
- [x] Run the focused new tests and confirm failure for missing implementation.
- [x] Implement only the read boundary and pure reducer; rerun focused tests.

## Task 2: Demo screen and navigation

**Files:** New `src/components/receptionist/receptionist-demo.tsx`, `src/app/(dashboard)/receptionist/demo/page.tsx`, new component/navigation tests, and one tool entry in `receptionist-home.tsx`.

**Consumes:** Task 1's `DemoBusiness`, state, reducer, and authorized reader.

- [x] Write failing component tests for prewritten-demo disclosure, keyboard-labelled conversation, callback correction/reset consent, distinct handoff/outcome approval, reset, and zero network/storage writes.
- [x] Add the guarded page, existing-design UI, and home link. Keep confirmation text explicit and provide an accessible transcript/status and inline validation errors.
- [x] Run new tests and existing home/setup/preview tests without editing existing tests.

## Task 3: Verification, review, and release

**Files:** New `e2e/receptionist-demo.spec.ts`, relevant receptionist docs, and this execution record.

- [ ] Add desktop/mobile browser rehearsals with fictional fields, mocked API writes, provider endpoints blocked, and assertions that demo interactions make no requests or storage writes. Include existing navigation and permission coverage.
- [ ] Run full unit tests, lint autofix, strict/fast type checks, Prisma validation, build, focused browser checks, and existing setup/callback regressions. Keep all AI/voice/website transports blocked during local build and execution.
- [ ] Obtain one independent whole-branch review, address material findings with regressions, and verify the final changes. Do not alter preexisting tests or dependencies without approval.
- [ ] Verify ordinary git revert restores the original code tree. Commit and merge when green, test the merged tree, push, and verify CI/deployment and safe browser behavior. Keep production widget settings and real records unchanged.

## Review focus

Permission freshness and tenant isolation; stale approvals/private-note exclusion; no provider-key selection or live request path; plain-text rendering; confirmation invalidation and repeated actions; bounded state and mobile/keyboard usability; demo receipts never resembling real saved records.

## Execution record

Baseline `b291beb`. Prior full baseline: 1,660 units, lint, and strict types passed with no code changes. Re-run narrow baseline before implementation and all required checks before completion. No schema or business-data changes are part of this feature; rollback is a normal code revert.

Implemented the guarded demo page, organization reader, bounded state machine, home entry, and new tests. No existing tests or dependencies changed. Full units 1,683/1,683, strict/fast types, ESLint autofix, Prisma validation, optimized build, existing home database checks 8/8, and new desktop/mobile browser checks 3/3 including auth passed. The first screen run caught callback-hours being interpreted as callback capture; a new failing regression drove the intent-rule fix. Corrected Testing Library-only selector options in new tests while retaining all assertions. No provider transport attempts recorded. Independent review and remaining browser regressions were completed as recorded below. Release verification follows the final merge.

Independent review passed all 23 new unit tests and found no security/correctness blocker. The transcript-scrolling usability finding was treated as material: a browser regression reproduced the hidden reply, then automatic scrolling within the transcript made the desktop/mobile checks pass without moving page focus. Full units 1,683/1,683, lint, strict/fast types, and optimized build passed again. Existing home/setup/handoff/outcome browsers 11/11 and home PostgreSQL 8/8 passed. No provider transport attempts or production demo records. No existing tests were edited.

Decisions retained after review: explicit callback-request phrases avoid capturing informational callback-hours questions; approved information is a snapshot until page reload, so later revocation does not erase already-delivered text; live AI/voice quality and real CRM mutations are excluded. Existing session resolution is unchanged. A code revert is sufficient because the feature changes no persistent business data. CI/deployment status is reported in the final release handoff.
