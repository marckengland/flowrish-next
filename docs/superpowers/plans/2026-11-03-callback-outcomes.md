# Callback outcomes Implementation Plan

**Goal:** Record staff-reported callback results, explicitly reschedule or close the existing callback task, and show overdue work without provider calls.

**Approved scope:** Reached / No answer / Needs another attempt; new owner and deadline; overdue queue; explicit closure of request and task together. User authorizes completion, fixes, mocked verification and merge. Real DeepSeek keys must never be retrieved/decrypted/used.

**Architecture:** One append-only, private outcome table. Lock the immutable handoff receipt, current task and lead, and source callback; compare a current-state fingerprint and reviewed action. Commit event + CRM note + task/source changes atomically. Request UUID + payload fingerprint give exact retries, including after reassignment. Outcome sequence is assigned under the receipt lock. No migration backfill or changes to existing tests/dependencies.

## Decisions

- Existing Task is reused; no new lead/task on outcome actions. Recording a result alone changes neither completion nor ownership/deadline. Rescheduling explicitly reopens a completed task, clears completedAt and sets selected current-org member/deadline. Close marks task complete, source callback reviewed if it still exists, and closes the request lifecycle permanently. It never closes the lead or changes its stage.
- A history close event is the request's closed state; callback review status remains a separate existing concept. No reopen-after-close flow in this release. Existing externally completed tasks remain visible as open requests until staff explicitly close the request.
- Standard optimistic concurrency and idempotency prior art: a changed callback/task/history invalidates approval. A completed retry cannot add another event/activity or overwrite later work. Events/receipts survive source/task deletion; deleted or inactive CRM targets are read-only and never recreated.
- Fresh org membership plus leads:read/leads:write required. Admin:settings can manage all org handoffs; other staff may manage only the currently assigned task. Prior original actors can retry their own already-applied request for an acknowledgement after reassignment, without receiving another owner's current details. All IDs are org scoped.
- Task/lead locks follow the existing task completion order to avoid lock cycles. Actor/new-assignee memberships remain locked through commit. Permission checks use existing application semantics, without globally serializing role edits.
- Audited notes are plain text, max2000 characters; results are manual reports, never a claim Flowrish placed a call. No phone/email/AI, automatic close, automatic handoff, widget activation, CAPTCHA or new scheduler.
- Queue is explicit load,20/page, open/overdue/closed/all. Staff see their own active lead tasks; admins see all. Overdue means unclosed request + incomplete task + deadline before now. History is20/page by monotonically increasing sequence, with older/latest controls.
- Source callback can be deleted independently. Existing task can still be resolved with history retained. Missing/deleted lead or task disables mutations; nothing is recreated.

## Implementation and verification

1. Shared strict DTOs/tests for drafts, preview, acknowledgement, detail/history and queue. Future dates only for rescheduling; fields cannot be silently ignored.
2. Add CallbackOutcomeEvent schema/migration with org FK only, request identity and sequence uniqueness, RLS and revoked PUBLIC/anon/authenticated grants. No existing receipt/task schema shape changes.
3. New service + disposable PostgreSQL tests first: permission/tenant/assignee checks, stale preview, exact retries, concurrent updates, rollback, correct task/source/lead effects, deleted sources/targets, queue filters/paging and zero provider calls.
4. Authenticated bounded same-origin HTTP routes, with task alias for assigned staff; new tests only.
5. One tracker UI reused in handoff receipt, task detail and work queue; explicit preview and approval, edit invalidation, stable retry ID, safe error handling, plain text, current-state refresh. Parent source list/task refresh after closure. New unit and mocked desktop/mobile browser tests.
6. Fresh independent review; full npm test, lint --fix, both TypeScript checks, Prisma validation and build; relevant PG regression suites. Don't overlap TypeScript/build or Playwright output directories.
7. Record read-only production before-state and prove code rollback preserving additive schema/migration using temporary Git index. Apply only after checks pass. Merge/push under session authorization; verify CI/deployment and production mocked/read-only smoke without real CRM writes.

## Review rulings

- Staff queue is mounted on Tasks for CRM writers, alongside the admin Settings entry point. A page-level regression test verifies non-admin staff access and read-only exclusion with no mount fetches.
- Successful acknowledgements stay successful even if reassignment makes a follow-up GET forbidden; inaccessible details are cleared. A real QueryClient test verifies shared task-cache invalidation after the acknowledgement.
- Queue closure refreshes a loaded sibling source list; task detail refreshes its server state. Mocked browser coverage verifies source-card removal and queue movement between overdue/open/closed views.
- Request/state checks and exact retries remain independent of current ownership once a request was already applied by the original actor; no current foreign-owner detail is disclosed.

## Tradeoffs

Closure is final in this release; later work uses normal CRM tasks. A task's manual completion outside this feature does not invent a call result or silently close its request. Outcomes and notes are retained as CRM history after callback removal. This makes later editing/erasure a separate deliberate operation; no history editing or bulk deletion is included.
