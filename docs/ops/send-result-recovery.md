# Follow-up send-result recovery

Each follow-up has one persistent send record. An explicit send reserves that record before email transport runs. A database lock prevents another tab, another operation ID, or a legacy client from dispatching the same follow-up again.

The server marks the record as dispatching immediately before Gmail's send request or Microsoft Graph's final draft-send request. It saves provider acceptance before writing email history, activity, or the lead's activity date. A failure in those later CRM writes therefore cannot trigger another delivery. CRM history may need separate repair; checking send status does not repeat those writes.

The composer checks the saved result on opening and offers **Check send status**. Both actions only read Flowrish's database. They never contact a provider, resend, regenerate, clear edits, or interpret restored draft text as delivery proof.

- **No attempt recorded:** you may explicitly send.
- **The send call did not start:** preparation failed before final dispatch. A new explicit send uses a fresh operation ID. The old operation is never retried automatically.
- **Unknown:** reservation or dispatch started without a persisted acceptance. Further sending is blocked. Check sent mail; a timeout or elapsed time never unlocks sending.
- **Provider accepted:** acceptance is stored and further sending is blocked. Acceptance does not prove arrival in the recipient's inbox.

An exact confirmed request can recover its stored receipt without transport. Reusing the same operation ID with changed content or attachments is rejected. New operation IDs cannot bypass unknown or confirmed results. An intentional later email needs a new follow-up.

## Private records remain after membership changes

`FollowUpSendAttempt` belongs to the scoped follow-up rather than an organization membership. Removing and restoring membership cannot erase duplicate protection. A newly assigned actor receives a blocked unknown status without the previous actor's operation or provider IDs. Reads and reservations require current membership, assignment and lead read/write access. Existing recipient, source-conversation, mailbox and Do not contact checks still run before transport.

The record contains a domain-separated HMAC of the request, state and minimal provider receipt. Subjects, bodies, recipients, file names and attachment bytes are not stored in it. HMAC input includes attachment bytes and metadata, preventing a changed attachment from reusing a receipt. The existing server encryption key derives the receipt key; no credential is added. Keep that key unchanged during rollback.

The additive migration enables RLS and revokes all table privileges from PUBLIC, anon and authenticated. Browser APIs use scoped, uncached server routes. Capability negotiation prevents old frontends or fixture backends from initiating unexpected status calls. Once a mounted composer has enabled recovery, a later missing capability cannot unlock an uncertain send.

The provider boundaries follow [Gmail message send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) and [Microsoft Graph message send](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0). Table protection follows [Supabase API security guidance](https://supabase.com/docs/guides/api/securing-your-api).

## Verify without sending

Run `npm run test:send-results:synthetic` with Node 22 and the existing cached PostgreSQL 17 image. The owned disposable runner applies copied-schema SQL offline and the reviewed migration to an empty synthetic table. It checks concurrent reservations, exact receipt recovery, constraint and RLS enforcement, membership retention, reassignment privacy, unknown outcomes and unchanged CRM rows. Delivery is an in-process mock; network and environment-file guards remain active.

The browser rehearsal adds six scenarios while retaining all earlier checks. Unit tests cover both Gmail and Graph dispatch hooks, preparation failure, lost acceptance and CRM failure. Production smoke adds an anonymous denial check only.

General lead composers, email previews and cadences are outside this release. Provider-side reconciliation, delivery/bounce tracking, manual unknown-result resolution, orphaned Graph draft cleanup, and automatic CRM repair are deferred. No live transport or AI calls are needed to verify this feature.
