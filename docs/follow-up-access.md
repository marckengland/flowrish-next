# Follow-up access and reassignment

The follow-up inbox uses current workspace membership, lead permissions, and lead visibility. Reassigning a lead does not transfer its email mailbox or email follow-up suggestions. Hidden suggestions stay pending; changing access does not delete work.

Pending callback reviews follow the callback task's current owner when that owner can see its lead. The former owner cannot approve or dismiss them. Reviewing a callback preserves its existing task. Reviewed history stays with its reviewer while the lead remains visible.

Every review checks current access before returning an already-reviewed result and after transactional task/audit work. A permission change during a blocked write rolls back the approval, task, and audit together. Callback materialization takes lead locks in ascending ID order before task and suggestion locks, matching email routing's lead order.

## Drafts and sending

Contextual generation checks access after conversation retrieval, before calling AI, and around the transactional draft write. An explicit send validates the stored draft version, original mailbox, source conversation, and recipient, including primary, alternate, and verified merged addresses.

A manually reviewed follow-up template also carries its follow-up ID. It starts a new email using the source's currently owned mailbox and the lead's current primary address. It cannot silently switch mailbox, lead, or thread. Ordinary manual API sends use fresh lead access too. Delivery checks run again after token refresh; Microsoft preparation checks also run between network steps.

These checks cannot recall an operation already accepted by a provider. An uncertain send is not retried automatically; check the mailbox first. Background cadence senders retain their existing contract.

## Browser behavior

The inbox and composer bind requests to the workspace and user that opened them. The server compares these expected identities with its authenticated session; client headers do not grant permission. Older cached clients without the identity fence must reload.

While visible, the inbox revalidates every minute and on focus. It removes inaccessible rows, closes write controls after permission loss, and clears private content after account/workspace denial. Older responses cannot restore a row removed by an access denial. Temporary errors preserve authorized edits and require an explicit retry.

Access and callback ownership apply before the 100-item page limit. Open drafts and a focused reply can be retained outside the current status/page, but every retained ID receives the same server access checks. A request can retain at most 100 IDs. Explicit navigation still asks before discarding unsent edits.

## Verification

The mocked suite covers current permissions, private response headers, identity fences, source/recipient binding, revocation during waits, and preservation/removal of drafts. Six added browser scenarios retain the previous 94 scenarios and all network/write guards. The synthetic PostgreSQL drill covers callback handoff, concurrent routing locks, rollback after a permission change during an audit wait, eligibility before pagination, retained-ID authorization, and membership loss using disposable data only.

No dependency, schema change, paid service, or production business-data test was added. Real AI/email delivery, mailbox sharing, global real-time revocation, background cadence authorization redesign, and provider recall remain outside this change. See [the recovery procedure](recovery/follow-up-access.md) for the tested fail-closed pause.
