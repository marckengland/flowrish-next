# Saved follow-up email drafts

Follow-up composers advertise recovery only when every loaded page supports `composeDrafts`. Older backends and clients retain the existing behavior. Recovery applies to follow-up email subject/body; other compose surfaces stay unchanged.

Edited text is saved after a one-second pause. **Saved** means the server acknowledged the exact content, operation, source and revision. The client keeps newer typing when an older save finishes. Offline edits, failed requests and unconfirmed results stay unsaved; reconnecting does not replay writes. **Check saved draft** performs a read. An exact lost-save receipt can be acknowledged without repeating the write. Otherwise the user reviews the saved version or retries the exact operation.

After reload, opening the composer offers a saved version without replacing current fields. **Restore saved draft** checks access and the selected version again. Changes to saved or local text during that read stop restoration. **Save current edits instead** is an explicit version-fenced replacement. Another tab's update or clear causes a conflict, never an automatic overwrite. Clear operations retain a revision tombstone so stale tabs cannot recreate old content.

Only acknowledged online saves survive reload. Attachments stay in the current tab. Recovery restores text, not action receipts: it does not prove whether an earlier email was sent, regenerate content, or send anything. Always check sent mail before retrying a delivery. A confirmed send only attempts to clear an exact matching acknowledged saved copy; failed or conflicting cleanup leaves the copy available with the same delivery warning.

## Private storage and authorization

`FollowUpComposeDraft` stores one encrypted record per organization, user and follow-up. The route requires current membership, lead-read/write access, the assigned actor, the captured workspace/account headers, and the current lead/recipient/thread/generated-draft binding. Source changes withhold old saved contents. Loss of access clears the visible private composer and recovery state.

AES-256-GCM binds ciphertext to its owner, workspace, follow-up, source version and revision. HKDF derives separate encryption and request-receipt keys from the existing server `EMAIL_ENCRYPTION_KEY`; no new credential is needed. Request receipts use HMAC rather than plaintext-content hashes. No draft text is stored in browser storage or audit/activity logs. Keep the existing encryption key unchanged during recovery or rollback. The native primitives follow [Node 22 crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html).

The additive migration enables RLS with no client policies and revokes all privileges from PUBLIC, anon and authenticated. Plaintext is returned only through the authorized server route. This follows [Supabase API security guidance](https://supabase.com/docs/guides/api/securing-your-api).

## Verification and rollback

Run `npm run test:compose-drafts:synthetic` with Node 22 and the existing cached PostgreSQL 17 image. The owned disposable runner strips deployment credentials, uses no host mounts, publishes PostgreSQL only on loopback, generates copied-schema SQL offline, and applies the reviewed migration to an empty fixture table. It checks scoped foreign keys, check constraints, encryption, client denial/RLS, concurrent CAS, tombstones, access changes and unchanged baseline CRM rows. Its report requires all three named checks. Production smoke now also denies anonymous access to the saved-draft route. The required CI job runs this drill after the existing inbox performance checks.

The complete mocked browser rehearsal retains all previous scenarios and adds six for reload/keyboard/mobile recovery, conflict between tabs, lost save acknowledgement, offline edits, delayed restoration and stale-account cleanup. No live AI or email transport is exercised.

See [saved draft rollback](./saved-compose-drafts-rollback.md). Reload recovery while offline, attachment persistence, send-outcome verification and a multi-version history browser remain outside this release.
