# Safe lead merges implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh whole-branch reviewer.

**Goal:** Replace immediate destructive merging with a scoped, immutable review and explicitly confirmed atomic archive/transfer.

**Architecture:** LeadMergeReview stores private actor-scoped previews and durable business receipts. Lead.mergedIntoId preserves the archived source. PostgreSQL guards serialize link writers against merges. Existing Next/Prisma/Zod/React/Vitest/Playwright; no dependencies.

**Spec:** docs/superpowers/specs/2026-11-05-safe-lead-merges.md

## Constraints and review focus

- Baseline4272c397b1a4a7a0c9b81ebf288ca2b2680a7c51; managed primary checkout on codex/safe-lead-merges. Preserve .serena/ and original .spec-workflow/.
- User approved existing merge property-test updates and six mocked browser scenarios (76→82), retaining all invariants and guards. Other existing test corrections require approval.
- No real provider calls/business mutations, no widget enablement, no new dependencies. Use Node22 and fake environment. No prisma db push; explicit temporary schema/config and synthetic PostgreSQL only.
- Lock waits must not retain stale authorization, expiry, versions or related-row sets. Concurrent link insertion must fail safely after source archival. Active/unmigratable workflow links block confirmation.
- Preserve primary fields, source scalar archive, all transferred data, contact union, transactional audit and same-ID replay. Deny inaccessible or foreign records without names/IDs leakage.
- Full checks: npm test, lint, build then strict/fast types, mocked82. Fresh whole-branch review, code/data undo proof, merge/push and exact CI/deployment/catalog/widget/anonymous verification.

## Task1: Private review and safe merge API

- [x] Write failing validation, service, duplicate search, route and retained property regressions.
- [x] Add marker/review schema and atomic migration with RLS/revocation and merged-source writer guards. Implement bounded snapshots, blocker checks, final authorization, conditional atomic transfers/audit/receipt. Retire unreviewed merge route and legacy destructive service.
- [x] Run narrow tests and synthetic PostgreSQL DDL/privacy/concurrent-link/rollback/conditional data-undo drill. Prepare a code disable switch and test its inverse.

## Task2: Review UI

- [x] Write failing component tests; add context-bound duplicate search, keeper selection, side-by-side field/count/blocker preview, explicit confirmation and uncertain-result retry. Wire actual workspace/account/delete permission.
- [x] Add six approved mocked desktop/mobile, ownership/access, blockers, stale and receipt-replay browser cases. Keep all76 existing cases and network/write guards.

## Task3: Verify and release

- [x] Run full configured checks, inspect desktop/mobile screenshots, get one fresh whole-branch review and resolve material findings with regressions.
- [x] Document behavior, limits and tested recovery.
- [ ] Commit, merge/test merged, push and verify all CI/deployment gates, migration checksum/privacy, anonymous denial and widget off. Preserve protected checkout and unrelated files.

All-or-nothing preservation makes workflow-linked and very large merges unavailable. Field selection, bulk/automatic merges and undo UI are deferred.
