# Send status on follow-up cards

Compact email cards show the saved send state without opening a composer. **Provider accepted** means Flowrish persisted acceptance, not recipient inbox delivery. **Send did not start** means preparation failed before the final provider call. **Needs checking** means reservation or dispatch lacks a confirmed result, or the record belongs to a previous assigned actor whose receipt must stay private. Cards without an attempt have no status badge.

**Check send status** reads the existing scoped status endpoint. It never sends, retries, regenerates, clears a draft, changes a task, or grants a composer permission to retry. A failed read keeps the last state and an explicit retry action. Reconnecting does not repeat a check. An acknowledged accepted badge cannot be downgraded by an older composer response. Locally uncertain results stay protected against stale list snapshots. A stale account or lost access clears private state.

## Filter every accessible page

**Needs checking** combines with search, source, tabs, reminders, Approved task progress, and deadline order. Lists and counts share a correlated SQL predicate before page limits. The predicate matches only email follow-ups with PREPARING or DISPATCHING attempts, plus records owned by another actor. It never reads another actor's receipt contents. Cursors bind the filter, so an old unfiltered cursor cannot continue a filtered query.

Changing only Needs checking uses the existing retained-page refresh. It keeps the same mounted subject/body editor and independently blocked Send button, including cards that no longer match. Existing discard/review protections still apply when other filters or tabs change. The applied-filter summary and saved views include the new optional setting. A status check refreshes counts but does not automatically remove the focused card; refresh the list when ready to update matching cards.

## Verify private metadata

Lists opt in with `x-flowrish-send-status: 1`. An advertised `sendStatus` capability requires valid scalar metadata for each email row on every page. A single batch fetches visible records; cards perform no individual requests on mount. List metadata contains only state and a safe update time, never operation IDs, request hashes, provider IDs, recipients, subject/body, or attachments. Previous-owner update times are withheld too.

Current assignment, lead scope and lead read/write access are required. Read-only users receive no badges and cannot query send-state counts or filters. A bounded batch locks leads and follow-ups, then rechecks current assignment and lead scope before reading the ledger. Non-waiting row locks produce a recoverable read error for contention, preserving drafts. Fresh final permission checks prevent revoked access from returning metadata. This follows [PostgreSQL row-locking semantics](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE). Missing filter support produces a visible error; it never silently widens results. A capability-only mismatch keeps edits, while a real scope or permission mismatch clears private data.

The existing send-result protection remains authoritative. Badge checks cannot unlock unknown or confirmed retries. Provider reconciliation, delivery/bounce checks, manual unknown-result resolution and CRM repair remain outside this feature.

Run the full mocked rehearsal for six new desktop/mobile, keyboard, retained-draft, lost-send, offline, stale-actor and saved-view scenarios. The existing send-result synthetic database drill retains its three original checks and adds `status-inbox`: three pages of matching rows, counts across tabs, overdue task intersection, cursor fences, cross-owner privacy, retained drafts, and revoked send access. It uses the owned disposable PostgreSQL runner and no external provider.

See [send-status rollback](./follow-up-send-status-rollback.md). No dependency or database migration is required.
