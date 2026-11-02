# Rehearsal questions to FAQ drafts

**Approved scope:** User accepted Create FAQ draft for saved flagged questions, editing in the library, explicit publication/public-receptionist approval, and backlinks to the rehearsal for retesting. Mocks only; no live AI/provider/Twilio requests or real-key access. Existing commit/push/merge authorization remains in effect. No dependencies or existing test edits without approval.

**Design:** Reuse the existing KnowledgeDocument editor and publication workflow. Store origin outside public document text in an additive RehearsalFaqDraft link table. Unique organization/rehearsal/message index makes repeated creation idempotent. Composite foreign keys enforce same-org document/rehearsal relations. Deleting the report removes the link but keeps its FAQ. Archiving a FAQ preserves the link and reopens the existing archived document for review.

**Tradeoff:** A separate link table preserves internal provenance across edits and keeps report URLs out of published knowledge. This needs an additive migration; reusing filename fields would lose provenance on file uploads. A draft contains only `Question: <caller text>\n\nAnswer:\n`; no model answer, review notes, neighboring messages, or business facts are inferred. Admin writes/reviews the answer before using the existing explicit publication and receptionist-approval actions. The report verdict and gap flags do not change automatically.

## Contract

POST `/api/admin/receptionist/rehearsals/[id]/faq` takes strict `{messageIndex: integer0..28, expectedUpdatedAt: ISOdatetime}` (bounded existing report HTTP reader) and returns `{data:{documentId: UUID, knowledgeUrl:'/knowledge?document=<id>', created:boolean}}`. Require session, fresh org membership and effective admin:settings. Org always from session. Lock Organization row to share library's 50-active-document cap, then lock the org-scoped rehearsal row to serialize review/deletion. Check current updatedAt and saved caller gap index before checking existing link. Existing link returns existing draft without changing it; otherwise create private FAQ revision1, link, and CREATE audit inside one transaction. No chunks/publication/approval/review/CRM/provider writes. Unexpected errors generic503. Stale review409; missing/cross-org404; non-caller/unflagged400. No-store responses.

GET `/api/knowledge/[id]/rehearsal` returns `{data:null|{rehearsalId,title,messageIndex,rehearsalUrl:'/settings?section=receptionist&rehearsal=<id>'}}` after current admin/member check and org scope. Metadata only, no transcript or notes; missing/cross-org documents404. A deleted report means no origin. All links generated server-side as fixed relative routes.

UI: create action beside saved flagged caller questions; unsaved review edits require Save review first. Component requests only on click, disables during parent/report work, handles409 and retry safely, validates returned URLs/IDs, ignores stale/unmounted responses. After create show Open FAQ draft link and explicit answer/review instructions; repeated clicks reopen same. Library accepts validated document query for initial editor selection, ignoring invalid input and keeping standard dirty-edit guard. New origin component loads source on explicit request (auto on a direct incoming document link), provides backlink and browser-retest link; no publication side effects. Settings accepts section=receptionist and a validated report UUID to open the exact report; viewing never starts preview or calls AI. Existing tests untouched; no extra fetches in old default mount paths.

## Tasks

- [ ] Shared contract + schemas/link validators; new red→green tests.
- [ ] Migration + Prisma model/relation, RLS enabled, PUBLIC/anon/authenticated privileges revoked. Disposable PostgreSQL tests for same-tenant FKs, concurrent retry safety, quota, stale/unflagged rejection, private draft/public retrieval boundary, deleted report retention.
- [ ] Root service/routes, new mocked auth/privacy/validation tests.
- [ ] UI worker owns new FAQ action/source components, minimal report/library/settings integrations and new tests. Root owns browser checks/integration.
- [ ] Full unit suite, lint autofix, both TS engines, Prisma validation/production build, guarded mocked desktop/mobile browser end-to-end loop. Independent review.
- [ ] Record production before-state read-only, verify full code revert in temporary index, apply additive migration only after checks, merge/push and verify CI/deployment using mocked UI data.

**Rollback:** Revert feature code; preserve the additive link table, index and any FAQ drafts. Old code remains compatible. Do not drop drafts/table, edit applied migrations, restore full database snapshots or force-push. No backfill or external side effects. Baseline main bde75ef; no origin table exists yet.

**Deferred:** AI-written answers, automatic grading, linking to an already-existing unrelated FAQ, copying review notes, automatically clearing gaps, report history pagination, and live phone/AI testing.

## Verification and review

The seven disposable PostgreSQL tests pass, including actual same-organization foreign-key enforcement and separate publication/receptionist approval. Mocked browser checks cover the full desktop/mobile loop, unsaved-edit navigation protection, idempotent reopening, and explicit manual retesting. Existing rehearsal browser flows pass. The independent review found no remaining major issues after the unsaved-document backlink was disabled while dirty or busy.

Final local checks passed: 1,388 unit tests, both TypeScript engines, ESLint autofix, Prisma validation, and production build. The final mocked browser run passed four feature/regression checks plus authentication setup. No existing test was edited. The full staged-code rollback and migration-preserving rollback both passed in a temporary Git index.

Production before-state and a migration-preserving rollback procedure are recorded in `docs/ops/rehearsal-faq-rollback.md`. No real provider key was read/decrypted/used and no provider transport was attempted during browser verification. Test questions, business facts, documents, and reports are synthetic.
