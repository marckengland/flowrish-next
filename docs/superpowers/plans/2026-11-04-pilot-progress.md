# Pilot setup progress implementation plan

> Use executing-plans inline. Obtain one fresh-context whole-branch review before merge.

**Goal:** Let explicitly authorized staff identify unfinished setup for approved pilot businesses without opening customer content or spending provider credits.

**Architecture:** Add an on-demand, read-only progress panel beside existing pilot invitation controls. Resolve the target only through an accepted pilot receipt and retained owner membership. Reuse website readiness validation and project category/rehearsal metadata into a strict response. No schema, dependency, or provider changes.

**Stack:** Existing Next.js, React, Prisma, Zod, Vitest, and isolated Playwright rehearsal.

## Requirements and decisions

- Explicit Flowrish staff grant is required before looking up any signup or target workspace. Recheck in a repeatable-read transaction.
- Unissued, active, expired, revoked, and joined invitations remain distinguishable. Missing receipt/removed owner access never permits arbitrary organization lookup.
- Show saved business, approved SERVICES/PRICING/FAQ categories, enabled valid organization AI configuration, saved allowed websites, widget state, and latest saved browser rehearsal status.
- Rehearsal completion requires a finished saved report with a passed review. Unsaved local simulation is not evidence. Changed business settings or configuration or any Library document updated after report creation make the report stale. This reports a saved review, never live provider quality or connectivity.
- Select no credential ciphertext, document text/title, report notes/title/transcript, callback details, or customer contact information for progress. Raw SQL projects only rehearsal status/timing and its settings version/finished flags.
- The next step is business, knowledge categories, AI, website, rehearsal, or manual review. This checklist does not change existing enablement policy or activate anything.
- Load only on explicit request; no polling. Clear stale progress before refresh, hide it on errors, clear the parent inbox on 401/403, and never retry writes.
- Existing tests retain assertions. Ask before correcting a wrong expectation or fixture. No live provider, sign-in, emails, real test records, or widget changes.

This deliberately avoids a new event store. Detailed history and unsaved simulation tracking remain harder to add later; neither is needed to answer the next-step question.

## Tasks

- [x] Add failing service/route contracts for staff denial, receipt-bound scope, safe fields, incomplete/current/stale rehearsals, categories, and no writes/providers. Implement minimal projection and shared readiness export.
- [x] Add failing UI tests for on-demand load, next steps, stale/error/revoked access, and no mutations. Build the panel using current inbox styles and integrate without automatic requests.
- [x] Add isolated desktop/mobile progress and access-revocation browser coverage; keep all prior scenarios and update exact count together.
- [x] Run formatter, focused tests, full tests, lint, build, strict/fast types, and browser rehearsal. Obtain independent review and fix regressions.
- [x] Verify code rollback. No schema or stored-data change requires reversal.

Release steps: merge/push the tested tree, verify CI/deployment read-only, and preserve widget off and unchanged production records. Record results in private release evidence.

## Ledger

- Base `1f60141051a72327caf5f43364038449369158a4`; branch `codex/pilot-progress`. Existing unrelated `.serena/` and `.spec-workflow/` remain untouched.
- User approved the proposed milestone view with “go”; continue with the existing inline implementation and mocked verification workflow.

- Review found that withdrawn documents vanished from the freshness query. A separate all-document maximum update time now invalidates removed/unapproved knowledge too. Real PostgreSQL regression first returned `passed` instead of expected `stale`, then passed after the fix. User approved the all-document aggregate fixture and regression, retaining every existing assertion.
- Additional review coverage: transaction-level grant denial and accepted receipts missing target identifiers.
- Disposable onboarding suite initially lacked `anon` and `authenticated` roles (`ERROR: role "anon" does not exist`); roles added only in the owned container, and all eight tests rerun. No test assertions changed.

- Independent review confirmed the freshness fix and found no new production issues. All 19 progress service tests pass, including grant recheck and missing identifiers. Real database suites pass 4 progress and 8 onboarding cases.

- Final local checks passed: 1,896 unit tests in 257 files; 33 browser scenarios; 4 progress plus 8 onboarding PostgreSQL cases; lint, strict/fast types, guarded production build. No provider calls or production writes.
