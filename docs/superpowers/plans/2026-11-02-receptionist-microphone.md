# Receptionist microphone implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Let administrators dictate an editable caller message in the existing browser receptionist preview without Twilio.

**Architecture:** A client microphone component wraps the browser's SpeechRecognition or webkitSpeechRecognition API. It requests recognition only after an explicit click, appends final text within the existing 2,000-character limit, and never sends a message automatically. The existing preview endpoint, AI responses, confirmation, and read-aloud remain authoritative.

**Tech stack:** Existing React, TypeScript, Tailwind components, Vitest and Playwright. No dependencies or database changes.

**Spec:** The user's request in this chat: microphone input for browser conversations, no Twilio spending, complete testing and merge. Implementation choices are the agent's: review before Send, browser-managed recognition, English recognition with a visible language selector for English Philippines, English US, and Filipino.

## Constraints and review focus

- Preserve existing tests. Add new test files only.
- Explain before use that the browser may process audio through its speech service. Flowrish receives only the text sent by the user.
- Keep text entry available when recognition is missing or fails.
- Stop recognition on cancel, timeout, hidden document, page exit, unmount, unsaved changes, or disabled preview; ignore stale events.
- Prevent simultaneous dictation, submission, and read-aloud. Do not automatically restart listening.
- Show accessible starting, listening, and finishing states and actionable permission/network errors. Never show raw error text.
- Preserve existing text, apply only final results, avoid duplicate results, and cap the combined text at 2,000 characters.
- Browser-managed recognition makes universal browser support and offline operation harder; do not claim those guarantees.

## Task 1: Dictation and integration

- [x] Add failing component tests for recognized editable text, no automatic send, unsupported API, permission/network failures, stop/cancel, duplicate/interim results, length limit, stale callbacks, disabled/unmount/hidden cleanup, and start exceptions.
- [x] Implement `ReceptionistMicrophone({ value, onChange, disabled, onActiveChange })` beside the preview, with bounded one-utterance recognition.
- [x] Integrate it into `ReceptionistPreview`, stop read-aloud before listening, disable submission while listening, and update the preview privacy copy.
- [x] Run the narrow new tests and preserve all existing preview assertions.

## Task 2: Browser proof and release

- [x] Add a separate browser spec exercising the actual controls with a controlled recognition boundary and existing API fixtures. Label this as simulated recognition, not acoustic transcription.
- [x] Attempt native recognition with synthetic speech in a supported installed browser without using a person's microphone. Record actual limitations honestly.
- [x] Run full unit tests, both typecheck engines, lint with fixes, production build, all database suites, and browser regressions.
- [x] Review the complete branch; fix findings with regression coverage.
- [ ] Merge and push authorized work, verify CI/deployment, and verify deployed controls. Reuse the live AI harness for provider integration if safely applicable.

Rollback: revert the code merge. There are no migrations, credentials, or telephony changes.

Verification before merge: 1,250 unit tests and 41 disposable PostgreSQL checks passed; both TypeScript engines, lint, and production build passed. Full compiled-app browser run: 41 passed, three existing selector guards skipped (cadence row, task card, New lead CTA). Native Chrome recognized the synthetic tune-up question with physical microphone permission denied and required explicit Send. AI replies in that acoustic test were fixtures. No existing tests or dependencies changed.
