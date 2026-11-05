# Do not contact email controls

Open a lead's detail page and use **Do not contact** to review email outreach restrictions. The page lists the lead's current primary/alternate addresses and archived merged addresses. A blocked address stops email outreach for every lead associated with that address in the same workspace.

## Block an address

1. Choose **Block** next to the address.
2. Enter the reason and review the workspace-wide effect.
3. Select the confirmation checkbox and choose **Confirm block**.

The change and audit entry commit together. Active and paused matching cadences exit with `do_not_contact`; their records remain. Inaccessible duplicate names and enrollment counts are not returned to the reviewer. A status refresh reads current preferences without changing them.

Blocking needs current workspace membership, visible lead access, and lead read/write permissions. Read-only users can inspect restrictions. Clearing also requires lead deletion permission, a new reason, and explicit confirmation. These are existing permissions; this release grants no new role permissions.

## Clear a restriction

Choose **Review clearing**, record the reviewed renewed contact request, confirm, and submit. Clearing retains the preference row and audit history. It does not restart or resume any stopped cadence. Another address on the lead may still be blocked.

If a save result is uncertain or the review becomes stale, refresh the status before starting another review. The UI keeps the reason after temporary failures and never retries a mutation automatically. It clears private data after access or account changes.

## Enforcement

The normalized workspace/address registry is independent of lead ownership and ID. Reassignment, duplicates, and reviewed merges cannot delete a stored block. Email sending checks current/alternate/archived addresses plus the explicit recipient, initially and after preparation waits. Outlook reply drafts are bound to the validated recipient and clear CC/BCC instead of retaining unverified provider recipients. Registry failures fail closed.

Preference writes, enrollment creation/resumption, and local cadence task/history/advancement effects share a workspace transaction lock. A block cannot miss a concurrently created enrollment or allow a waiting task to commit afterward. Durable jobs revalidate local effects even when their earlier action result was cached; next-step scheduling checks again after delays. An ACTIVE-only pause cannot overwrite a contact-driven exit.

The UI's version binds the reviewed lead/address snapshot and preference revisions. The API additionally checks captured workspace/user identity, same origin, current access, and bounded JSON. Private API responses use no-store caching. Direct public/browser database grants are revoked and RLS is enabled on the registry table.

## Limits and verification

This release covers email outreach and cadence work. It adds no public unsubscribe link, automatic consent classification, or phone/SMS dialer controls. Not blocked is not proof of consent. Existing inbound email sync and callback records remain available. A newly added unrelated address is not globally blocked solely because another address used to be on a record; stored old-address restrictions remain. More than 200 direct merge archives fails closed for administrator review.

A provider operation already accepted cannot be recalled by a later block. Database locks do not span provider or scheduler network calls. A queued scheduler event that was already accepted still checks current restrictions before effects.

Verification uses mocked providers and disposable PostgreSQL data. The migration, duplicate/archive/tenant behavior, both block/enrollment orderings, audit-wait rollback, local task serialization, cached-stage denial, and pause race are covered. No real emails, DeepSeek requests, or widget activation are needed. See [recovery](recovery/contact-preferences.md).
