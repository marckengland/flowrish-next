# Saved follow-up draft recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Request one fresh read-only final review.

**Goal:** Privately save edited follow-up email subject/body and offer safe explicit recovery after reload.

**Architecture:** Add an encrypted per-user/workspace/follow-up table, a scoped route, and a debounced composer recovery hook. Follow the existing capability-negotiation pattern so older list responses keep working. Bind saves/restores to current source metadata and optimistic revisions. No provider calls or browser plaintext storage.

**Tech stack:** Existing Prisma/Postgres, Node AES-GCM, Zod, React, Vitest/Playwright. No dependencies.

**Spec:** Approved saved draft recovery proposal in this chat.

## Constraints and limits

- Widget off, no DeepSeek, no real emails. Synthetic database and mocked transport only.
- Never auto-restore, send, regenerate, replay a failed mutation, or replace newer server edits.
- Access/source checks precede returning plaintext. Membership/lead/assignee fences and same-origin bounded requests apply.
- Save subject and body only; attachments and action-result receipts are not restored. A restored draft does not prove whether an earlier send succeeded.
- Offline edits remain unsaved until acknowledged; reload recovery requires server access. No browser storage fallback.
- Additive private table only. Rollback keeps encrypted rows and the applied migration; no production drops or data deletion.

## Task 1: Private persistence

- [x] Add failing validation, encryption, service and HTTP tests before implementation.
- [x] Add private schema/migration with scoped foreign keys, size/revision constraints, RLS and denied client grants.
- [x] Implement source-bound encrypted storage, compare-and-swap saves/clear tombstones, idempotent exact receipts and safe failures.
- [x] Generate Prisma offline with dummy configuration; verify in a disposable database using copied-schema SQL, never root db push.
- [x] Test rollback with retained private schema/data and unchanged core records.

## Task 2: Composer recovery

- [x] Add failing composer tests for acknowledgement, explicit restore, offline/error, races, conflict and revoked access.
- [x] Add opt-in negotiated capability, Saving/Saved/Unsaved states, bounded debounce, explicit recovery/conflict review and restored editor content.
- [x] Add six guarded browser scenarios and retain all 256 existing scenarios; required total 262.
- [x] Run full tests, lint, build, mocked rehearsal; strict/fast types after builds. Obtain final review and fix important findings.

Release procedure: merge/push when verified, then verify CI, migration health, exact deployed commit, anonymous denials and widget-off state. Save evidence in the task ledger.

**Tradeoff:** This adds a private table and API; it avoids leaving plaintext drafts in shared-browser storage. It does not provide offline reload recovery, attachment persistence, send-outcome verification, or a version-history browser.
