# Receptionist readiness and scenarios

**Goal:** Help an organization prepare the saved receptionist setup and rehearse common situations without hidden provider calls.

**Authorization:** User approved the next-step proposal with “go” and explicitly chose “Mocks only” for verification. No live DeepSeek request, connection test, real-key access/decryption or telephony action is authorized for this work.

**Design:** Add an explicit read-only saved-setup checklist and five reusable fictional caller prompts. Presence checks do not prove business facts, model answers, credential validity, billing availability, or phone routing. No new dependency, database table, credential/configuration mutation, or automatic AI request.

## Contract

GET `/api/admin/receptionist/checklist` returns `{data: ReceptionistChecklist}` from `src/lib/receptionist-checklist.ts`. Current membership and effective `admin:settings` permission are checked before any settings query. Organization comes only from the session. Response is no-store. Five entries check saved business name, valid business hours, manual/approved published knowledge, current callback owner plus open stage, and safe AI configuration/remaining daily allowance. Metadata projections must exclude API-key ciphertext and secrets; never call resolveOrganizationAi, decryption, provider test or fetch. An existing paused/invalid/exhausted organization provider cannot fall back to the deployment key. Missing org provider may report deployment-key presence only. All connection checks remain unverified.

UI checklist has an explicit **Check readiness** button. It makes only the GET above and shows counts plus an unverified-connection/phone note. No auto-load or activation. Unsaved settings disable the check and explain why. Parent remounts it after saved settings/dirty status changes so stale completion does not survive edits. Existing quick knowledge check stays unchanged.

Scenario buttons appear in an active unfinished browser preview: pricing, unknown answer, callback details, correction and confirmation. They replace the editable caller draft only. They never send, contact a provider, start a preview, enable reception, save CRM data, or confirm anything automatically. Correction/confirmation require an awaiting-confirmation state. All scenarios are disabled during AI requests, dictation, or unsaved changes. Prompts use fictional US 202-555-01xx numbers. Guidance says what to look for rather than declaring a test passed.

## Tasks

1. Main: new checklist service/GET route and new auth/privacy/metadata tests; new scenario data/component + preview integration and mocked scenario tests. Watch new tests fail, then implement.
2. UI worker: checklist component + minimal ReceptionistSettings integration + new component/browser fixtures. No existing test changes.
3. Verify full unit suite, both typecheck engines, lint, production build and focused mocked browser scenarios with outbound LLM requests blocked. Review auth, key projection, no-send behavior and stale state. Merge/push under session authorization and verify CI/deployment with provider endpoints mocked.

**Tradeoff:** Manual presence checks are cheaper and safer than automatically grading live AI conversations, but a person still needs to review approved business facts and actual replies. Callback-routing completeness is informational for browser preview; no phone readiness is certified.

**Rollback:** Revert the code merge. No database or provider state changes need reversal.

## Verification

- All 1,330 unit tests passed, including new service, route, checklist, settings integration, and scenario coverage. Existing tests were unchanged.
- ESLint with autofix, TypeScript, native TypeScript, and the production build passed on Node 22.
- Seven mocked browser checks passed: saved checklist and callback correction, mobile edits/layout, dictation review, denied microphone permission, unsupported recognition, onboarding, and stale preview reset.
- Browser runs used a server transport guard. No AI provider transport was attempted. No saved API key was read or decrypted by the new checklist.
- Review found a low-positive-token false completion. The checklist now requires enough allowance for the full configured input/output reservation, with regression coverage below and at the boundary. Smaller requests may still fit when the checklist needs attention.
- Live AI answers, credential validity, actual provider billing, physical microphone hardware, and phone routing were not tested. No database schema, dependency, business settings, or CRM changes were made.
