# Update lead owners or statuses in bulk

Open Leads and select individual rows or **Select all leads on this page**. Choose one field and its new value, then select **Preview changes**. Review each lead’s name, ID, old value, and new value. Check **I reviewed these exact changes** and select **Confirm bulk update**.

Preparing a preview does not change leads. Confirmation updates the whole reviewed batch or rejects it. A changed, deleted, or inaccessible lead requires a fresh preview. Unchanged rows are counted without changing their timestamps or writing audit entries. Changing pages, filters, saved views, business, account, or lead versions clears the selection and unconfirmed review.

If the confirmation response is lost, select **Retry confirmed request**. This sends the same request ID and retrieves its stored result without repeating completed writes. Do not start another batch while its result is uncertain. Reloading closes this browser’s retry control; inspect lead history before preparing another batch.

## Access and limits

- Both `leads:read` and `leads:write` are required. Read-only users have no selection controls.
- Existing lead-access rules apply. Owners and admins can choose current business members; managers can choose users in their accessible teams; members can choose themselves.
- At most 100 unique leads, one field, and one target per batch. Selection covers the current page.
- Previews expire after 10 minutes. Each account/business can hold 20 pending previews. Creating another preview removes that actor’s expired pending previews and applied receipts older than 90 days.
- The owner selector shows up to 200 eligible members. Larger directories need a future searchable selector.
- Only `leadStatus` or `assignedUserId` changes, plus `updatedAt`. Stages, close dates, tasks, cadences, and messages are untouched. Assignment does not send a notification.

## Server guarantees

`GET /api/leads/bulk` lists eligible owners. `POST /api/leads/bulk/preview` accepts a client-generated UUID, versioned selection, and one change. `POST /api/leads/bulk/apply` accepts only `{id, confirmed: true}`. Session identity owns every operation; workspace and expected-user headers reject stale tabs. Responses are private and `no-store`. Mutation bodies require same-origin JSON and are limited to 32 KiB.

The private `BulkLeadUpdate` table stores IDs, versions, old field values, a request hash, and a destination identity hash. It does not store lead names or emails. Confirmation locks the receipt and selected leads, refreshes authorization after lock waits, locks destination membership and identity, and checks every version and old value. Conditional writes, per-lead audit entries, and the receipt commit in one transaction. Applied receipts clear their snapshots and return counts only. Fresh authorization checks also apply to receipt retries.

## Verification and recovery

See [release evidence and rollback](recovery/bulk-lead-updates.md). Automated verification uses invented data and mocked providers. It does not create real leads, send emails, activate the receptionist widget, or call DeepSeek.

Deferred: selection across pages, shared previews, bulk stages/deletion, undo buttons, assignment notifications, searchable owner directories, and automatic retries. An all-or-nothing batch cannot make partial progress when one lead changes.
