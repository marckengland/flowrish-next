# Receptionist onboarding and preview implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guide each workspace through receptionist setup and provide a browser conversation test without telephony or CRM writes.

**Architecture:** Reuse the saved ReceptionistConfig and pure advanceCall state machine. A new admin-only preview service and routes return ephemeral conversation state and callback summaries. Existing settings host guided setup and a lazy preview UI. The public call service and preview share approved-knowledge generation and greeting logic.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma/PostgreSQL, Zod, Vitest, Playwright. No added dependencies or schema.

**Spec:** docs/superpowers/specs/2026-11-02-receptionist-onboarding-preview.md

## Global constraints

- No Twilio purchases, paid phone activation, or real-call success claims.
- No dependencies or existing test changes without user approval.
- No secrets, raw credentials, or customer transcripts in logs or tracked files.
- Preview must never write CRM, audit, config, or call records.
- Use only current-org public-approved knowledge and the saved manual FAQ.
- Preserve unrelated untracked .serena and .spec-workflow directories.
- Root handles commits, merge, push and deployment under existing session authorization.

## Shared contract

GET /api/admin/receptionist/readiness → { data: { saved: boolean, settingsVersion: string|null, approvedDocuments: number, hasManualKnowledge: boolean, voiceConfigured: boolean, hasAuthToken: boolean } }.

POST /api/admin/receptionist/preview input { state?: CallState, settingsVersion?: string, speech?: string, digits?: string }. Empty input starts a new preview from saved config and returns greeting. Subsequent turns require a matching settingsVersion. Response { data: { state: CallState, settingsVersion: string, reply: string, finished: boolean, callback: null|{fullName:string,phone:string,reason:string}, sources: Array<{id:string,title:string,revision:number}> } }. Callback summary only when the state machine returns capture:true; reply must clearly say no callback was saved. New source metadata is admin-only and never added to speech.

Error codes use existing errorResponse conventions; no config returns actionable 409; stale config 409; invalid/oversized input 400/413. Saved disabled config may preview. No Twilio requirement. Session org + admin:settings required before provider/database reads. Bound messages, text sizes, turn count and request body. Fresh knowledge per AI turn. Callback confirmation is deterministic and makes no AI request.

## Task 1: Backend and state boundaries

- [ ] Add failing new tests for preview greeting/name, disabled/no-provider operation, confirmation without writes, stale config, public knowledge scope/revocation, errors/fallback, bounds and unauthorized routes.
- [ ] Extract a small shared greeting and approved-knowledge generator from existing call logic without changing public behavior.
- [ ] Implement preview/readiness service and new routes with the contract above.
- [ ] Run narrow tests, scoped lint, and typecheck. Root reviews diff and test evidence.

## Task 2: Guided setup and browser preview

- [ ] Add new component tests before implementation. Keep baseline assertions and existing editor behavior.
- [ ] Add guided setup in the existing settings style with business identity, knowledge, test and optional phone steps. Live greeting uses current input; testing uses saved settings and explains pending edits.
- [ ] Add lazy preview component consuming the shared contract, typed turns, optional read-aloud, deterministic keypad confirmation, clear preview-only outcome and source metadata. Fail safely and permit restart.
- [ ] Keep phone activation separate and off unless user explicitly configures it. Do not invent a readiness success percentage.
- [ ] Run narrow component tests, scoped lint/typecheck. Root reviews accessibility/mobile appearance.

## Task 3: Verification, research notes and rollout

- [ ] Add synthetic browser flows: custom business name through save, preview while disabled/no phone, callback confirmation with zero live writes, read-aloud fallback, stale settings/reset, mobile layout, auth boundaries.
- [ ] Add a disposable PostgreSQL preview test proving no lead/task/activity/call/audit/config changes, with mocked provider and real retrieval/permissions.
- [ ] Document how setup/preview work, competitive findings and limitations. No live-phone test claimed.
- [ ] Independent full-diff review, full unit suite, all PostgreSQL suites, lint/formatter, both typecheck engines, build and browser suite. Test code rollback in an archive; no schema rollback needed.
- [ ] Merge, push, verify CI/deployment and live synthetic browser flow. Do not persist test customer records or call a real phone.

## Review focus

- A saved configuration changes during a preview: reject stale state and require restart.
- A knowledge document is revoked mid-preview: retrieve fresh public sources and do not replay assistant facts.
- A client forges state or another org ID: remain read-only, bound input and use current session's organization only.
- A provider fails during a correction: preserve deterministic fallback/readback and require confirmation.
- Read-aloud is unsupported or the panel closes: no stuck playback or failed conversation controls.
