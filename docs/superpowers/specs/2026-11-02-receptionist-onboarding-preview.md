# Receptionist onboarding and browser preview

## Intent

User requested receptionist activation and a real call, then specified no Twilio budget. They approved browser test mode with typed conversation and optional browser read-aloud, using the existing AI connection and creating no real leads or tasks. They asked for business-name onboarding informed by competitors. This release adds guided receptionist setup and an authenticated preview; paid phone activation and real-call claims are excluded.

## Experience

Keep the existing Settings → AI receptionist editor and saved configuration. Guide admins through business identity/hours/callback ownership, approved business knowledge, testing, then optional phone connection. The greeting uses that workspace's entered business name. Never hardcode an example business into a saved configuration or voice greeting. Show a live greeting preview and distinguish unsaved edits, saved settings, checked knowledge, tested conversation, and phone configuration. Avoid claiming phone routing is verified from stored credentials alone.

Preview uses saved settings, even while real reception is disabled and no voice account exists. Require saving edits before testing; reset the test after configuration changes. Start, type caller turns, optionally press keypad 1 to confirm, end/reset. Optional read-aloud is off by default, uses browser speech synthesis only, and cancels on stop/reset/unmount. Unsupported speech playback has a clear text-only fallback. No microphone, recording, telephony, or new service credentials. The existing AI provider's usage rules still apply.

The preview runs the production conversation state machine and fresh approved receptionist knowledge. It accepts no client organization ID, business configuration, or library audience override. Client conversation state is untrusted, schema-validated, and bounded. Only current organization admins can access it. Do not route through the call service's CRM-writing function. Explicit confirmation ends with a preview-only callback summary and a statement that nothing was saved. No ReceptionistCall, Lead, Activity, Task, FollowUpSuggestion, audit, or configuration writes from preview requests. No transcripts are persisted by preview. Preserve knowledge revocation and caller-only AI history rules.

A readiness API supplies current saved-settings version, public-approved document count, manual-FAQ presence, and voice-credential presence without secrets. Stale preview sessions after saved configuration changes must restart. Knowledge status uses only that organization's current approved snapshots. Display missing knowledge as a reason to expect callback collection, not as an invented business answer. No global onboarding gate outside this settings section.

## Constraints and tradeoffs

Reuse Next.js/React, existing UI, Zod and current business knowledge services. No dependencies or schema migration. Preserve existing tests and public webhook behavior. Ask before editing a pre-existing test if its setup is outdated. Full tests/typecheck/lint/build and disposable PostgreSQL regression checks are required. Browser fixtures cover setup and dry-run confirmation; real provider tests use synthetic content only and require existing AI connection. Real phone routing, speech recognition, voice quality, web crawling/import, multilingual calls, appointment booking, and paid usage remain deferred. Browser preview makes low-cost dialogue iteration possible; proving actual carrier behavior remains a separate future test.

## Prior art checked November 2, 2026

- Frontdesk setup checklist and playground: https://www.myaifrontdesk.com/help/getting-started/setup-wizard and https://www.myaifrontdesk.com/help/getting-started/testing
- Rosie review/test/forward sequence: https://heyrosie.com/
- Goodcall demo before phone plan: https://www.goodcall.com/faq
- Smith.ai scenario practice before launch: https://smith.ai/ai-receptionist

Vendor descriptions are their own claims, not independent performance verification. Our proposed advantage for this project is clear approval boundaries, callback ownership in its CRM, and test access before telephony spend, not a claim of overall superiority.
