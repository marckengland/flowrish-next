# Merge-aware replies implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, one fresh whole-branch reviewer at the end.

**Goal:** Match replies through merged lead lineage, hold conflicts for owner review, and preserve explicit sending approval.

**Architecture:** Shared resolver and transactional stored-message router. EmailMessage.leadRouting stores decisions/replay receipts; owner-scoped API/client review panel in Follow-ups. Existing stack, no dependencies.

**Spec:** docs/superpowers/specs/2026-11-05-merge-aware-replies.md

## Constraints and review focus

- Baseline a39934e062b452835a4b2e2e7b62013ad81fdc46; branch codex/merge-aware-replies in protected managed checkout. Preserve .serena/ and original .spec-workflow/.
- No provider calls, real CRM writes, widget enablement, dependencies, or secrets in output. Node22/fake env. Prisma setup uses temporary explicit configuration/offline SQL and owned synthetic PostgreSQL; never root db push.
- Matching, mailbox/account ownership, invalid merge graphs, duplicate targets, replay, actor revocation while blocked, source changes, concurrent sync/review, wrong recipient drafts, and any failed audit must fail safely without partial links/stops.
- Existing test corrections need user approval; user approvals cover sync/reply fixtures, review/send fixtures, browser selectors/readiness, and six browser scenarios82→88 while retaining all checks. Other corrections require approval.
- Full checks: npm test/lint/build then strict/fast types; mocked88; fresh review; disable proof; merge/test merged/push/CI/deployment/catalog/anonymous/widget verification.

## Task1: Resolver and stored-message routing

- [x] Write failing resolver/router/retained sync-reply tests, implement bounded archive-aware matching and atomic activity/suggestion/cadence/audit/decision routing. Remove independent inline sync linking. Preserve identity/overlap/checkpoint/replay coverage.
- [x] Add leadRouting nullable JSON/check/index migration and test with owned PostgreSQL. Verify all-or-nothing failures, lock waits, ambiguity, lineage changes, account/member revocation and repeat no-op.

## Task2: Reviewed conflicts and draft boundaries

- [x] Write failing owner/user/workspace/origin/version API tests and implement current match previews + explicit link/dismiss receipts. No stale/inaccessible selection or silent override of existing links.
- [x] Add optional context-bound Follow-up inbox panel, acknowledgments, same-request retry, refresh that respects open drafts, and readonly/error/revocation handling.
- [x] Verify contextual alias recipients through stored routing/activity/current lineage; preserve existing send approvals and unrelated-recipient rejection. Add six approved browser cases and retain all82 prior cases/guards.

## Task3: Verify and release

- [x] Full checks, screenshots, synthetic drill, one fresh review and targeted fixes. Document limits, baseline and exact disable recovery; test the pause patch.
- [ ] Commit/merge/test merged/push and verify all CI, exact deployed SHA, migration/index/RLS, anonymous denial and widget off using no real message routing/AI calls. Cleanup only owned scratch/resources.

This design makes very large/invalid alias groups and historical backfills require explicit follow-on work. Conflicts can delay cadence stopping until reviewed; they never pick an arbitrary lead. No automatic forwarding, model calls, draft generation or sending is added.
