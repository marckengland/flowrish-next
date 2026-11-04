# Workspace switcher implementation plan

> Execute inline with one fresh-context whole-branch review before merge.

**Goal:** Let existing members choose a business, show its name and permissions, and prevent cached or stale-tab work from crossing workspace boundaries.

**Architecture:** A user-bound HttpOnly cookie chooses the active membership without changing the database default. Server session resolution rechecks membership and filters roles. The authenticated shell pins its workspace in same-origin fetch headers. Middleware stamps the actual method/path and rejects stale cookie/header combinations before actions run. Session resolution also rejects mismatched or missing write context. An explicit switch clears query memory and business-specific browser pointers, broadcasts to other tabs, and performs a full navigation.

**Scope:** Existing memberships only. No workspace creation, membership/role grants, schema, dependencies, provider calls, emails, production test records, or widget changes. Preserve every existing assertion; ask before correcting fixtures. Keep unrelated `.serena/` and `.spec-workflow/` untouched. Continue the authorized commit/merge/push workflow after checks.

Switching discards unsaved edits. Preserving separate drafts and independent active businesses in separate tabs becomes harder with the shared browser cookie and is deferred. Tabs deliberately move together; stale requests fail closed even when broadcasting is unavailable.

## Tasks

- [x] Add failing session, HTTP, and middleware tests for selected membership, scoped roles, foreign/revoked membership, user-bound selection, stale read/write context, and safe document recovery. Implement cookie helpers, request context checks, and membership-only list/select endpoints. Same-origin POST changes only the selection cookie.
- [x] Add failing client tests for safe same-origin fetch headers, API and server-action context, paused writes, unrelated request preservation, scoped browser cleanup, and explicit selection/failure recovery. Add a responsive native select in the existing sidebar and a standalone recovery chooser. Hard navigation clears memory; other tabs clear and reload.
- [x] Add isolated desktop/mobile browser scenarios for two synthetic businesses, role/navigation changes, cache reset, stale-tab denial, forbidden/revoked selection, and uncertain switch recovery. Preserve all existing rehearsal scenarios and no-provider guards.
- [x] Run focused tests, full tests, formatter/lint, guarded production build, strict and fast types after build, and the whole mocked browser rehearsal. Obtain fresh review and fix findings.
- [ ] Test code rollback, merge/push the checked tree, verify CI/deployment read-only and unchanged widget/production counts. No production workspace switch is needed for verification.

## Review focus

- A tab left open during another tab's switch must not submit old form values into the new business.
- Native or unhydrated writes without pinned workspace context must fail after a selection cookie is set.
- A revoked or another user's cookie must not grant access or silently retarget a write.
- A lost switch response must lead to explicit recovery, without repeating the POST.
- Provider requests, unrelated local storage, theme preferences, and the public website must remain unaffected.

## Ledger

- Base `5bd148db3e2aa1e6b746e064157de1850915b68f`; branch `codex/workspace-switcher`. Baseline passes 1,921 tests in 266 files.
- User approved the proposed feature with “go” and approved empty cookie/header fixtures for existing session tests, retaining every assertion.
- Ruling: use the existing checkout on a feature branch, matching this session's workflow. No new dependencies or workspace setup are needed.
- Ruling: put request binding in the authenticated shell, preserving static public rendering. Use middleware method/path stamps for server-action and native POST checks; browser events alone cannot prevent stale writes.
- Server red/green: selected-workspace session, stale/native writes, membership-only list/select, canonical request stamps, and refreshed auth-cookie forwarding pass. Original session permission/fallback assertions remain and pass with the approved empty request fixtures.
- Client red/green: pinned API/Next-action fetches, unchanged external/static calls, paused work, selective storage cleanup, explicit choices and safe read retries pass. Existing sidebar/layout regressions pass unchanged.
- Browser red: new business scenario failed on missing “Studio prospect” before fixture integration; stopped the remaining red run after that proof. The original 38 scenarios passed in that red run. Six additive workspace scenarios now bring the exact suite count to 44.
- All 44 browser scenarios pass with no guard violations. Full unit run found one existing Library race: the text field was already present before extraction completed. User approved waiting for its extracted value; every original assertion remains and the focused eight-test suite passes.
- Independent review found a P1: Google/Microsoft OAuth document callbacks resolved the newly selected business, allowing consent begun in A to replace credentials in B. The initiation URLs had no OAuth state. Scope now includes standard short-lived, user/business-bound state cookies and callback permission/state checks before token exchange. Popups open blank synchronously to preserve browser activation and navigate only after the same-origin initiation succeeds. Unsolicited popup messages are ignored.
- Final review found no remaining P1/P2 issues. Provider callback errors now use fixed safe text; the privacy regression failed before that fix and passes afterward. Full suite passes 1,949 tests in 273 files. All 44 browser cases and seven safety probes pass. Guarded production build, lint, strict types and fast types pass. Production manifests contain the real routes and exclude fixture routes/cookies.
- Rollback retains server selection/request guards, the browser boundary and recovery chooser, and all OAuth hardening. Only the sidebar picker is hidden. A blanket revert could retarget requests from already-open tabs or consent windows; no membership, default, or schema rewrite is part of recovery.
