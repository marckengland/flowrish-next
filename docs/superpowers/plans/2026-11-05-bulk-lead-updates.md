# Bulk lead updates implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh whole-branch review.

**Goal:** Select current-page leads, preview one owner/status change, explicitly confirm, and atomically apply only the reviewed versions.

**Spec:** User-approved proposal and “go”. No dependencies, real AI/provider use, widget activation or real CRM writes for verification. Existing 70 mocked browser scenarios/guards remain; user approved six more and total76.

**Architecture:** A private membership-owned `BulkLeadUpdate` record holds an immutable 10-minute preview and an idempotent applied receipt. All API ownership comes from the session, fenced by expected workspace/account. Fresh membership, read/write permissions, existing lead-access rules and destination membership are checked again on apply. Ordered row locks, version predicates, audit entries and receipt commit in one transaction; any stale/inaccessible lead rejects the entire batch. Only one field (owner or lead status) changes; stages, tasks, cadences and messages are untouched.

**Tech stack:** Existing Next.js/React/Prisma/PostgreSQL/Zod/Vitest/Playwright. Standard PostgreSQL transactions and optimistic concurrency; no added tooling.

## Constraints and review focus

- Reuse the protected native worktree on `codex/bulk-lead-updates`, baseline `1f382a75022758886e816c5623314ca4c18bc26f`. Preserve unrelated `.serena/` and original-checkout changes.
- At most100 unique current-page IDs. Previews store IDs, timestamps and old field values, not lead names/emails. Max20 pending previews per account/business; expired pending previews and receipts older90days are cleaned for that actor on preview creation.
- Private table creation/RLS/revocation is atomic. No `prisma db push`; local verification copies schema/config with loopback dummy datasource and applies offline SQL inside an owned disposable container.
- Owners/admins may assign current members; managers may choose users in their existing lead-read scope; members may choose themselves. Target membership and displayed identity hash must still match on apply.
- Account/workspace changes, lost responses, overlapping batches, changed/deleted/inaccessible leads, audit failure and changed owner membership must not produce partial or repeated updates.
- Selection/review clears on page/filter/saved-view/data-version changes. Read-only users have no selection controls. No writes on selection, target editing, cancellation or focus; preparing a preview writes only its private preview record.
- Run narrow regressions red→green, full configured checks, root build before strict/fast types, all76 browser scenarios with guards, and one final independent review. Existing test corrections require approval.

## Task 1: Service and private API

- [x] Add strict schemas, mock service/route regressions and observe failures before implementation.
- [x] Add membership model/migration and implement options, immutable preview, and confirmed apply endpoints. Use actual current roles/access predicates, ordered locks, all-or-nothing CAS updates, transactional per-lead audit and receipt replay. Apply returns counts only.
- [x] Verify validation, scope/permissions, expiration, target changes, no-op rows, stale/partial updates, audit rollback, response loss and privacy. Verify migration/DDL failure rollback and conditional data undo on owned PostgreSQL17 with invented records.

## Task 2: Current-page UI

- [x] Write selection/preview/confirmation/retry/context/keyboard tests before code. Add optional bulk context to LeadTable so current read-only/default tests retain their behavior.
- [x] Add native accessible row/page checkboxes and a small toolbar. Freeze selection versions, load allowed options lazily, preview exact rows and one target, require explicit confirmation, clear review after any context change, and retry uncertain apply with the same preview ID.
- [x] Add six approved browser cases: desktop/mobile status flow; owner flow; stale/denied atomic rejection; uncertain-apply replay; selection/page/filter/account boundaries. Preserve all70earlier cases.

## Task 3: Verify and release

- [x] Run full tests/lint/build/strict/fast and mocked76. Address the fresh review with regressions.
- [x] Document use, limitations and rollback. Prepare/test code undo retaining schema/migration; prepare conditional audit-based data undo and verify no-op second run plus unchanged unrelated records.
- [ ] Commit/merge/test merged/push under session authorization; verify CI, migration checksum/privacy, exact deployed commit, anonymous denial and widget-off without real CRM/AI writes. Preserve the app-protected checkout and unrelated files.

All-or-nothing batches make partial progress harder: one changed lead requires a new preview. Sharing previews, bulk deletion/stage changes, undo buttons, notifications, automatic retries and all-pages selection remain deferred.
