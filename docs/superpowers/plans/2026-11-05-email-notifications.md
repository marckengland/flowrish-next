# Email attention notifications implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; one fresh whole-branch reviewer at the end.

**Goal:** Surface pending email work in existing notifications without provider calls or automatic business actions.

**Architecture:** Query current eligible routing/suggestion sources; persist only idempotent private per-member read receipts. Add context-bound endpoints and optional UI integration; preserve callback APIs and tests. Existing Next/Prisma/Zod/Vitest/Playwright, no dependencies.

**Spec:** docs/superpowers/specs/2026-11-05-email-notifications.md

- [x] TDD shared candidate SQL, service count/list/read/focused-target, HTTP identity/origin/size/privacy checks. Add receipt model/migration with RLS/revokes, offline explicit-config client generation and owned synthetic PostgreSQL checks. No root prisma db push.
- [x] TDD email inbox, combined bell, age and context/revocation/retry handling. Pass org/user from header/server page. Add focused match/follow-up reads and stable links without auto-actions or draft loss. Preserve legacy callback mode; add six mocked browser scenarios88→94 after user approval.
- [ ] Full npm test/lint/build then strict/fast types, mocked browser94, screenshots, real synthetic database proof, fresh review and targeted fixes. Record baseline and tested code-revert recovery. Merge/push and verify exact CI/deploy/schema/anonymous/widget off. Cleanup only owned scratch/resources; retain protected checkout.

The split callback/email sections keep this change small; a combined timeline needs a later API contract. No live provider verification or real CRM test writes are authorized.
