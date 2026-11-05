# Follow-up access implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, then one fresh whole-branch reviewer.

**Goal:** Enforce current follow-up access through list, review, generation and final manual delivery without live providers.

**Architecture:** Shared fresh authorization/lead policy, transactional review/materialization/draft commit, expected-actor HTTP fences, context-bound composers and non-destructive access revalidation. Existing stack; no schema/dependency changes.

**Spec:** docs/superpowers/specs/2026-11-05-follow-up-access.md

- [x] TDD current lead/actor visibility, history and callback ownership; implement shared access helper and transactional list/review with safe payloads/current capabilities. Update approved old fixtures retaining assertions.
- [x] TDD network/write wait revocation and final source proofs; harden draft commit and all manual API deliveries, preserve template vs contextual reply behavior; add HTTP identity/origin/privacy fences and server identity provider/client cleanup/revalidation. Add approved mocked6 scenarios94→100.
- [ ] Run full Node22 checks (build before strict/fast), browser100/screenshots, synthetic PostgreSQL race/rollback drill; fresh review and fixes, fail-closed recovery proof, docs. Merge/push/CI/deploy read-only verification and cleanup only owned scratch; retain protected checkout.

Callback task ownership may move; mailbox data never moves with a lead assignment. Just-in-time external authorization protects checks before dispatch, not provider recall. No global role rewrite or background cadence changes.
