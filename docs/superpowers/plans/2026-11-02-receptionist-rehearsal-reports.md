# Receptionist rehearsal reports implementation plan

> Execute in this session using existing project patterns. The user's “go” approves the four proposed report features; mocks-only verification remains mandatory.

**Goal:** Save browser rehearsal snapshots separately from customer calls, inspect knowledge supplied per reply, flag unanswered questions, and record a human Passed/Needs work review.

**Architecture:** Explicit save only. A server-only organization-scoped table stores a bounded immutable transcript and editable manual review. Settings offers saved history on explicit request. No AI grading or provider calls for reports.

**Constraints:** No real DeepSeek-key access/use, no live provider or Twilio requests, no dependencies, and no changes to existing tests without approval. Reuse admin:settings plus fresh organization membership checks. No CRM, callback, or business-setting writes. Existing preview API behavior remains compatible.

**Tradeoff:** Client-submitted snapshots support rehearsal review cheaply; they are not tamper-proof audit records. Sources describe retrieved documents supplied to an answer; they do not prove factual support. Manual FAQs may also have been available. Keeping source titles/revisions in snapshots makes current-approval verification a separate future feature.

## Contract

RehearsalSnapshot: clientId UUID, settingsVersion ISO datetime, finished boolean, messages (1–29): role caller/receptionist, content 1–4096 chars, sources (up to 8) id UUID/title1–200/revision positive integer, generation scripted/ai/fallback. Caller messages have no sources and scripted generation. Total UTF-8 payload <=96 KiB. Human review: verdict unreviewed/passed/needs_work, notes <=2000 chars, unansweredMessageIndexes unique indices of caller messages only. Create payload adds title1–120. Transcript is immutable after saving. Same organization/clientId retries return original saved snapshot.

API: GET/POST /api/admin/receptionist/rehearsals; GET/PATCH/DELETE /api/admin/receptionist/rehearsals/[id]. Org/user always from session. GET list shows latest25 with metadata only, order createdAt desc/id desc; detail scoped by org+id. No raw errors/logs. No-store responses. Missing/cross-org report =>404. Validate body bounds before JSON parsing; unknown fields rejected. Review updates require expectedUpdatedAt; stale =>409. Sources stored as submitted review metadata, never fetched or trusted as authorization.

UI: Add RehearsalReports(snapshot, disabled) to browser-preview card. Snapshot exists only after actual preview response. Root captures per-message sources/generation and creates fresh clientId for each successful turn, resetting with preview. Saving makes no provider call. History explicit Load saved rehearsals, latest25. Accessible detail with transcript/source labels and review form, per-caller “Needs knowledge” checkbox, library link, save review, explicit delete confirmation. Generic errors/retry; cancel/ignore stale results. No automatic save or grade.

## Tasks

- [ ] New shared schemas/types with tests for bounds/roles/source data/review indices.
- [ ] Additive Prisma model/migration: organization cascade, clientId unique in org, chronological index, RLS enabled, revoke PUBLIC/anon/authenticated; no Data API policies. Generate client using repo tools.
- [ ] Service + routes with new mocked tests for org isolation/current permission, strict payloads, retry idempotency, stale review conflicts, not-found deletes, safe errors, no providers.
- [ ] Independent UI worker: new report component/tests using shared contract. Root integrates snapshot capture and writes new parent tests. Existing tests untouched.
- [ ] Disposable Postgres migration/service tests with synthetic organizations. Verify RLS/grants, same-org duplicate save, cross-org reads/writes, no CRM changes, and code-revert rollback against additive table.
- [ ] Full unit tests, lint autofix, both TS engines, production build. Mocked desktop/mobile browser tests with outbound AI blocked. Fresh independent code review.
- [ ] Commit/merge/push under existing session authorization; verify CI/migration/deployment and deployed UI with mocked report+preview requests.

## Rollback

Before: main b37cebe, report table absent. Revert feature merge to remove report routes/UI; leave additive table and reports intact. Test revert applies cleanly on disposable index/tree and old code remains compatible with added table. Do not drop saved report data, edit applied migrations, restore full DB snapshots, or force push. Recovery is a normal code deployment; saved reports remain recoverable.

## Verification evidence

All 1,358 unit tests pass. The four disposable PostgreSQL checks pass. Mocked browser checks cover desktop/mobile report saving, review conflicts, reopening, knowledge-gap flags, deletion confirmation, the existing readiness scenarios, microphone input, permission denial, unsupported browsers, onboarding, and stale preview reset. Both TypeScript engines, lint autofix, Prisma validation, and production build passed. Existing tests were unchanged. Review findings for concurrent-save idempotency and lost delete responses were fixed and regression tested.

No real AI key was retrieved, decrypted, or used. No provider transport was attempted in browser verification. Live AI answers, current source approval, actual billing, physical microphone hardware, telephony, and tamper-proof transcript provenance are outside this release. History lists the latest 25 reports; there is no pagination or automatic grading.

Rollback procedure and before-state evidence: `docs/ops/receptionist-rehearsal-rollback.md`.
