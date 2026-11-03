# Guided website receptionist setup

**Goal:** One five-step flow for business identity/hours, approved Library knowledge, website permissions/budgets, a clearly simulated rehearsal and explicit activation. User approved implementation through “go”; existing session authorizes verification/fixes/merge/deployment. No real DeepSeek key retrieval, decryption or usage, provider calls, Twilio spending, production test writes, dependency changes or preexisting-test edits.

**Design:** A dedicated admin-only /receptionist/setup page links from existing receptionist Settings. Reuse KnowledgeLibrary upload/save/publish/approve UI and website configuration UI through optional embedding props. Keep original default behavior unchanged. Services, pricing, FAQs and public opening hours remain approved Library facts; a saved-hours template can populate a new draft, never publish/approve it automatically.

## Safety and behavior

- New read-only setup summary includes only business subset, website metadata/limits, knowledge counts/categories and at most one complete paragraph from current approved published documents. It never includes private receptionist knowledge, draft text, phone routing, credentials or encrypted key values. AI readiness uses the existing metadata-only validator; this is not a live connection check.
- A subset business PATCH uses current settings under row lock and optimistic version checks. It preserves phone enabled state, routing, assignments, private text and all unrelated settings. Invalid existing config is not silently reset. Conditional creation defaults to phone off.
- Share the existing website configuration transaction writer/readiness policy. Final activation checks a version of business, website, approved Library revisions and AI metadata, then enables atomically under existing org/config/document/provider locks. No schema or migration is needed.
- Step3 config-only embedding never offers activation, preserves an existing enabled state on explicit edits and keeps spending acknowledgement when editing a live widget. Step5 requires current saved readiness, a local simulation bound to the snapshot, separate simulation/spending acknowledgements and an explicit button. Existing Settings activation remains available and unchanged.
- The local rehearsal renders a scripted greeting, one approved fact/unknown guidance and a sample callback readback/consent. It makes no model, public-widget, call, lead/task or rehearsal-save request. It is clearly labeled simulation, not verified AI accuracy. A changed snapshot or fresh page requires a new simulation before guided activation.
- Use callback dirty/busy/change props on embedded editors. Navigation/reload guards preserve drafts until explicit discard; step changes cannot interrupt in-flight writes. New wizard requests use mounted-response checks and synchronous locks, strict response IDs/DTOs and generic errors.
- Existing enabled organizations can review setup without being disabled or reactivated automatically. Empty libraries, stale concurrent edits, missing metadata, invalid origins, unavailable providers, long approved paragraphs, lost responses and changed snapshots must fail safely.

## Implementation / verification

1. Strict shared DTOs and tests first. Add summary/business/launch services with fresh membership + admin:settings, same-origin bounded write routes and immutable snapshot versions.
2. Extract shared website transaction writer/state reader without changing legacy endpoint behavior. New disposable PostgreSQL tests verify no writes on read, secret-free projections, full approved paragraphs, CAS/create races, preservation of live phone settings, current readiness, stale launch rejection, explicit activation and no provider/CRM/budget changes.
3. Add optional embedding callbacks/template to KnowledgeLibrary and configuration-only mode to WebsiteReceptionistSettings. New tests cover the embedding contracts; keep every preexisting test unchanged.
4. Add wizard, local mock conversation and dedicated page/link. New unit + mocked desktop/mobile browser tests cover save/upload/publish/approval/config/simulation/enable, stale responses, dirty/busy navigation, resume and already-enabled states.
5. Independent review, npm test, lint --fix, tsc, fast typecheck, Prisma validate, build, relevant real disposable PG regressions and mocked browser regressions. No overlap of TS/build or Playwright outputs.
6. Before pushing, prove reverse in a temporary index. This release is code-only: revert the merge to disable the guide; preserve separately approved configuration/Library/activation changes. Merge/push under session authorization and verify CI/deployment with mocked/read-only production checks. Never activate a production widget for verification.

## Tradeoffs

Simulation state is intentionally local and resets when inputs change or the page reloads. It is not a claim that a model, website installation or phone routing works. The guide reuses existing business-hour rules (one same-day interval, no overnight schedule) and existing Library formats/approval policies. No new credential form, OCR, live AI test, automatic publication, phone onboarding, bulk import or schema is included.

## Execution record

- Baseline: 1,501 unit tests passed. New contracts, HTTP routes, editor embedding, simulation, and guide tests were written before implementation; missing-module/behavior failures were observed before their green runs.
- Shared website writer extraction retained the existing 20 disposable PostgreSQL tests and all existing UI assertions unchanged. Setup database coverage uses only a disposable synthetic database and denies provider transport.
- Independent review identified missing-row creation, application-link navigation, and embedded reload issues. The real database race failed before the fix (`expected 409, received null`); create-only semantics now return 409 and retain concurrent phone settings. Link protection and confirmed-reload remounting preserve local drafts. An additional paragraph allegation was disproved by source inspection and real-newline tests already passing before any change.
- Ruling: keep pending read completion guarded by mounted state rather than aborting writes. Aborting a committed write cannot undo it; synchronous request locks, stale-state checks, and reload/retry recovery provide the required behavior.
- Browser history uses an early startup bridge and native discard confirmation before Next handles traversal. Declining restores the current entry, which can replace the forward branch. Unit and browser checks cover the draft surviving a declined Back action.
- Ruling: the real browser disproved page-level popstate ordering, despite its isolated unit passing. A small root-head bridge now registers before hydration and forwards history events to the active guide guard. It is inert without that guard. The browser case enters through the Settings link and checks both declined and accepted Back actions.
- The full suite exposed an intermittent existing Library link assertion running during document loading. The user explicitly approved readiness waits. Added waits before document clicks and the final source-button assertion, retaining every original assertion.
- Local verification: 10 setup and 20 existing widget tests passed on disposable PostgreSQL. The desktop/mobile guide (including Back keep/discard), existing website-admin and outcome browser suites, and authenticated/anonymous metadata smoke passed. No provider transport attempt was recorded. Before deployment, repeat the full unit check on the merged tree and verify CI, deployment, and the same mocked/read-only production paths.
