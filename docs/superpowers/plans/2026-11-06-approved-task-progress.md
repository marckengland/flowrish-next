# Approved Task Progress Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh whole-branch review at the end.

**Goal:** Show current task due dates/completion in Approved, filter open/overdue/completed, and preserve personal views, drafts and paging.

**Architecture:** Extend the existing filter with an optional taskProgress value and bind it to cursors. Use an opt-in request/response capability so existing clients keep their contracts. Apply scoped task predicates before the page limit, enrich only authorized linked tasks, and recheck task/lead access before returning minimal metadata. Approved progress reads do not run callback catch-up or mutate work.

**Tech Stack:** Existing Next.js, React, Zod, Prisma and PostgreSQL; no dependencies or migrations.

**Spec:** User-approved chat description: Approved inbox task due/completion display; Open, Overdue and Completed filters; saved views and unsent drafts retained; read-only progress, no task completion/reassignment actions.

## Global Constraints

- No new dependencies, DeepSeek, real emails or authenticated production test writes; keep the widget off.
- Retain every existing assertion/scenario; ask before correcting incorrect fixtures or expectations.
- Match existing CRM task scope: members see their tasks; managers see authorized workspace tasks, subject to accessible lead and matching task/source linkage.
- Open means unfinished, including overdue. Overdue means unfinished and due before the server's check time. Completed uses persisted isComplete. Unavailable tasks do not expose dates or imply completion.
- Progress filter applies only to Approved; leaving that tab clears it. Personal views retain it. Missing optional field preserves old view/filter serialization.

## Review Focus

1. Task deletion, reassignment, wrong workspace/lead and permission loss must redact metadata without mislabeling completion.
2. More than100 suggestions, changed task state during loading, cursors and retained drafts must filter correctly before limits and reject inconsistent pages.
3. Due-time boundaries and completed tasks with null timestamps must use server time without invented completion dates.
4. Older saved views/cursors/clients must remain usable; progress-aware views must not silently broaden on an older client.
5. Switching tabs, saved views, focus refresh and bulk-approval recovery must preserve drafts and require explicit discard where applicable.

### Task 1: Scoped read contract and query

**Files:** new src/lib/follow-up-task-progress.ts and src/server/services/follow-up-task-progress.ts with tests; extend filter/query/cursor/access services, list route and opt-in HTTP capability.
**Interfaces:** taskProgress optional OPEN|OVERDUE|COMPLETED; task metadata discriminated UNAVAILABLE versus state+dueDate+completedAt+checkedAt; x-flowrish-task-progress:1 opts in. Absent opt-in preserves existing list contract.
- [ ] Write failing contracts, cursor, service and HTTP tests for bounds, wrong tabs, role scope, privacy, task races and no writes.
- [ ] Implement optional filter, scoped pre-limit SQL, minimal task metadata with selected-row locks/final authorization, and capability handshake. Preserve old cursor hashes when no new options are used.
- [ ] Run narrow and existing follow-up/access/paging tests without weakening assertions.

### Task 2: Approved UI and saved views

**Files:** follow-up page reader/client/inbox, new progress display component if useful, saved follow-up view contracts/client/route compatibility, new UI tests.
- [ ] Write failing display/filter/draft/tab/saved-view tests, including stale metadata redaction and legacy capability refusal.
- [ ] Implement accessible All/Open/Overdue/Completed selection only in Approved, server-derived progress display, retained draft guard, and optional saved filter.
- [ ] Hide progress-specific saved views from legacy saved-view readers; modern client opts in. Keep revision and identity fences unchanged.

### Task 3: Verification and release

**Files:** six new mocked browser scenarios; approved rehearsal154→160; recovery note and disposable drill in this plan's scratch directory.
- [ ] Verify desktop/mobile, complete/overdue/unavailable states, read-only access, saved views, draft protection, load more, errors and scope changes; retain all154 existing scenarios/guards.
- [ ] Exercise real SQL/services on isolated PostgreSQL with synthetic >100 task-linked suggestions, ownership/version races and unchanged database row counts. No root prisma db push.
- [ ] Run npm test, npm run lint, npm run build, then npx tsc --noEmit and npm run typecheck:fast; run npm run test:receptionist:mocked.
- [ ] Perform one fresh branch review, fix confirmed defects RED→GREEN, verify the full suite and exact rollback, then authorized merge/push and CI/deployment/anonymous/widget checks.

Recovery: revert application changes; saved view JSON containing the new optional filter is retained. Legacy readers must hide those views until support is restored, rather than applying an unfiltered view. No destructive database undo. This approach leaves task editing in CRM and provides live paged reads rather than a transaction spanning user browsing time.
