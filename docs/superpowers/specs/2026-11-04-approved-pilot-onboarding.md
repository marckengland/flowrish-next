# Approved pilot onboarding

Approved scope: explicitly granted Flowrish staff approve a waitlist signup, issue an expiring single-use link for manual copying, and track invited/joined status. The prospect signs in with the invited verified email, creates their own organization, and continues into receptionist setup.

## Authority and credentials

- Reuse the membership-bound `WaitlistStaffAccess` gate. Customer organization administrators and new pilot owners do not gain staff access.
- Invitations last seven days. Store only a SHA-256 token hash; return the private URL once after explicit staff approval. Keep plaintext only in the current panel's memory, with an explicit Copy button. Never send or log links automatically.
- Put the token in a URL fragment. The pilot page removes the fragment before exchanging it through a bounded same-origin POST for a one-hour HttpOnly, SameSite=Lax, host-only cookie (Secure and `__Host-` in production). No bearer values in query strings, storage, telemetry, or auth-provider redirects.
- A validly shaped fragment can establish a browser cookie without revealing invitation validity. Anonymous status responses disclose no prospect data. Verified email equality and the server's authenticated application user are required before metadata or redemption.
- Staff can revoke an unused link and explicitly issue another generation. Reloaded or uncertain issuance cannot recover plaintext or silently rotate a token. Already accepted invitations cannot be reissued or revoked as a way to change organization membership.

## Redemption

- Viewing a page or status never consumes an invitation. Creating the workspace requires business name, slug, and explicit confirmation.
- Use a transaction-aware path through existing organization initialization. Lock actor, source signup, and invitation in a consistent order; recheck token, expiry, revocation, email, source, and membership before writes.
- Only users without existing organization membership can create a pilot workspace. Existing members receive guidance; their memberships/defaults remain unchanged.
- Create the organization, default team, roles/permissions and owner memberships, consume the invitation, and mark the signup joined atomically. Failure leaves no partial organization or consumed invitation.
- Retries by the same user return the original workspace receipt. A removed membership does not permit workspace recreation. Preserve receipts with restrictive deletion references.
- Pilot login callbacks return to `/pilot` and never auto-accept team invitations. Validate auth continuation paths as local paths; no external redirects. OAuth and magic-link verification are mocked during tests.
- Continue to the existing `/receptionist/setup` only for the created workspace's active membership. Clear the pilot cookie after acknowledged completion. A lost response can be recovered by reloading status without another creation request.

## Scope and verification

Existing ordinary signup settings continue to govern other onboarding paths. This release does not change global signup policy, grant pricing/trial terms, enable a widget, copy organization AI credentials, send invitations/emails, call providers, or create production test users/organizations.

Use unit/route/UI tests, disposable local PostgreSQL transaction and rollback tests, and isolated browser fixtures. Keep all previous assertions. Run full tests, types, lint, build and browser rehearsal, obtain independent review, test code rollback while retaining receipts, and verify production read-only.

Deferred: acceptance into an existing workspace, multi-workspace account switching, automatic delivery, bulk issuance, invitation history beyond the latest generation, and app-managed staff grants.
