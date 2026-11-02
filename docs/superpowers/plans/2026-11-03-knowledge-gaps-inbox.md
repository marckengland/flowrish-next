# Knowledge gaps inbox

**Approved scope:** Collect saved flagged caller questions across all rehearsals, group repeated questions, show linked FAQ state, and require manual retesting before resolution. Saved-data only; no AI/Twilio requests or real-key access. Existing session authorization covers finishing, testing, merging and deployment. No dependencies or existing-test edits without approval.

**Design:** Add an explicit-load inbox in AI receptionist Settings. Query all current saved caller flags in PostgreSQL and paginate groups and occurrences, rather than limiting work to the latest 25 reports. Normalize only case and whitespace using deterministic SQL; hash normalized UTF-8 with SHA256 for fixed group keys. Keep original question text for display. One private KnowledgeGapReview row per organization/key stores the human resolution fingerprint, notes, actor and time. Report flags/verdicts, FAQ text/publication/approval and credentials stay unchanged.

**Freshness:** A source fingerprint covers every current matching occurrence (report id/index/updatedAt) and its linked document id/updatedAt. Groups resolve only when the user confirms retesting and the saved fingerprint is current. Source changes or new flags reopen the group automatically; no live AI grading is implied. Request version also includes review updatedAt for optimistic concurrency. A new resolution never silently edits old reports. This cautious rule makes unrelated report-note changes require another review.

## Contract

Shared DTOs in src/lib/knowledge-gaps.ts. GET /api/admin/receptionist/knowledge-gaps?status=open|resolved|all&page=1 returns {data:{groups:KnowledgeGapGroup[],page,pageSize:20,hasMore:boolean}}. Group: key/version 64hex, question1..4096, occurrenceCount, latestAt ISO, status open|resolved, changedSinceResolution boolean, faqCounts {draft,published,approved,archived}, resolution null|{notes,resolvedAt}, no transcripts/credentials. Fixed ordering latestAt desc/key asc.

GET /api/admin/receptionist/knowledge-gaps/[key]?page=1 returns {data:{group,occurrences:KnowledgeGapOccurrence[],page,pageSize:20,hasMore}}. Occurrence: rehearsalId/title/messageIndex/updatedAt/rehearsalUrl fixed internal; faq null|{documentId,title,status,knowledgeUrl fixed internal}. Query original flags only, ignore non-caller/empty malformed entries; org from session. All data bounded and paginated in SQL. Existing FAQs displayed by state, including archived/unpublished documents.

PATCH /[key] takes strict {expectedVersion,action:resolve|reopen,retested:boolean,notes<=2000}. Resolve requires retested=true. After current membership/effective admin check, lock org then current scoped report and linked-document rows in stable order, recompute current group and expected version, upsert KnowledgeGapReview. Stale409; missing/cross-org404; known errors safe and no-store. Resolution data never acts as authorization. Manual reopened row has null fingerprint/time/actor. New/changed sources after resolution display open.

POST /[key]/faq takes strict {expectedVersion}. Lock org, recompute version, reuse existing group FAQ if available (prefer nonarchived), otherwise use canonical oldest occurrence through the existing private-FAQ transaction helper. Same org lock plus existing per-occurrence unique link prevents duplicate group creation under concurrent requests. Return existing FaqDraftResult. No inferred answer, publishing, approval, report updates or provider calls.

## Implementation

- [ ] Shared schemas/link validation tests red→green; pass immutable contract to UI worker.
- [ ] SQL CTE for current flags, deterministic keys/source versions/status and bounded list/detail pagination; metadata-only server service and strict routes with new auth/stale/bounds tests.
- [ ] Additive private KnowledgeGapReview model/table, RLS/revoked PUBLIC/anon/authenticated; generate and validate Prisma. Extract existing FAQ transaction body without changing its behavior, preserving existing tests unchanged.
- [ ] UI worker: new inbox component/tests, one minimal ReceptionistSettings render. Explicit load/filter/page/select, occurrence FAQ status/links, group draft action, manual retest checkbox+resolve/reopen and notes, dirty/stale protections, safe errors and cancellation. No auto AI/preview.
- [ ] Disposable PostgreSQL tests: grouping beyond history25, org isolation, pagination, private/public/archived FAQ states, resolution/reopen/new-source invalidation, stale concurrency, source/FAQ creation race and no external/CRM/config writes.
- [ ] Full tests/lint/both TS engines/Prisma/build; guarded mocked desktop/mobile browser tests; independent review; recorded production before-state and tested migration-preserving rollback.
- [ ] Apply additive migration after checks; merge/push; verify CI/deployment and production UI with intercepted fixtures only.

**Tradeoff/prior art:** This is a conventional human-reviewed work queue with optimistic versions. Deterministic grouping is cheap and explainable; semantically similar wording stays in separate groups. Raw PostgreSQL aggregation avoids loading unbounded transcripts into the app. Exact source fingerprinting may reopen a group when only a report note changes, protecting against stale resolutions.

**Rollback:** Baseline main43bc9b2. Disable application feature by reverting its code while preserving additive Prisma schema and applied migration; keep review rows and FAQ drafts. No backfill or deletion. Recovery one normal deployment. Never edit/delete an applied migration, drop saved data, restore full DB snapshots or force-push.

**Deferred:** Semantic/AI grouping, automatic answers/grading, automatic report-flag clearing, automatic publication/approval, real provider/phone tests, and merging unrelated existing FAQs.

## Implementation rulings and verification

- Manual review notes remain available after reopening; resolution metadata has a nullable resolvedAt. No report flags are cleared.
- Opening an existing group FAQ can succeed from an older version because it only returns a current authorized link. Creating a new FAQ and saving a resolution require a current version. This also recovers safely when a successful creation response is lost.
- The organization lock is FOR NO KEY UPDATE so concurrent document publication can finish its foreign-key checks. Source rows/documents are locked before recomputing the resolution version. The existing FAQ transaction helper retains its prior behavior.
- SQL filters empty flag arrays before extracting question metadata. It ignores non-caller, blank, non-string and out-of-bounds saved flags. Grouping applies only case and whitespace normalization.
- Successful writes refresh the current list page before enabling paging. Known external version changes invalidate paging. A confirmed FAQ save survives subsequent refresh failures with its link and notes intact; stale actions require a reload.
- Source-version changes clear the UI retest checkbox. Unsaved notes prompt before list/page/Settings-tab navigation. No new or existing test is skipped or weakened.

Eleven disposable database tests pass, including deterministic publication/resolution concurrency. The independent final review passed 30 targeted checks with no remaining major findings. Rollback procedure and production before-state are recorded in `docs/ops/knowledge-gaps-rollback.md`.

Final local verification passed: 1,418 unit tests, seven existing FAQ database integration checks, both TypeScript engines, ESLint autofix, Prisma validation, production build, and four mocked desktop/mobile feature/regression checks plus authentication setup. No existing test was changed. No AI provider transport was attempted. The temporary-index rollback preserves the additive schema and applied migration while returning application code to the baseline.
