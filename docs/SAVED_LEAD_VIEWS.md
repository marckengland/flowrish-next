# Saved lead views

Saved lead views keep named filter combinations for your account in one business. They are available from **Leads** on your other devices after signing into the same account and choosing the same business. A view never grants access to additional leads.

## Save and use a view

1. Open Leads and choose your search, stage, status, tier or assignee filters.
2. Wait for search typing to finish, enter a **View name**, then select **Save as new view**.
3. Choose a **Saved lead view** and select **Apply view** to replace the current filters. The lead table returns to its first page.

Each account can save up to 20 views per business. Names contain 1–80 characters and must be unique within that account/business; names are case-sensitive. Search text is limited to 200 characters. Saved views contain filters only, not lead records, sort order, visible columns or a default selection.

## Edit or delete

- **Rename view** saves the name in the text field.
- **Replace saved filters** replaces the selected view's filters with the current lead filters.
- **Delete saved view** opens a confirmation. Confirming removes only that preference; it does not delete leads or clear the active filters.

Views are private, including from other members or administrators of the same business. Removing an organization membership deletes that membership's saved views. Rejoining starts with no saved views from the former membership.

## Other devices and unavailable views

The list refreshes when the page opens, when its window regains focus, and through **Refresh saved views**. Changes from another device never automatically replace the active lead filters or a draft name. If a selected view changed, refresh and use **Reload selected view** before editing it. Version checks reject stale updates and deletions rather than silently overwriting changes.

If a view refers to a stage, assignee or pipeline unavailable on the current page, applying it shows an error and keeps the active filters. Choose valid filters and replace the saved filters, or delete the obsolete view.

If a save response is lost, **Retry save** resends its original identifier, name and filters. The server returns the same existing view instead of creating another copy. No write is retried automatically.

Each device remembers its active filters locally under an account/business key. These active selections are separate from the server-saved view list. The former unscoped local-storage selection is not imported because it has no reliable account/business owner. Team sharing, live push updates and saved table layouts are outside this release.

## Private API and verification

`GET/POST /api/lead-views` and `PATCH/DELETE /api/lead-views/:id` require an authenticated session, current membership and `leads:read`. The server resolves the workspace and user; client identity fields and list query parameters are rejected. Writes require same-origin JSON, have an 8 KiB body limit, and validate filter references inside the workspace. Every response is `no-store` and successful responses identify the session scope so a stale browser component can reject mismatched data.

The browser also sends `x-flowrish-view-user` as an expected-account fence. Mutations require it to match the authenticated session before any service action runs. Reads check it when provided. This header cannot select an owner or grant access; it prevents a stale tab from saving under an account signed in through another tab.

The table uses a membership foreign key with scoped cascade deletion, RLS with no browser policies, and revoked PUBLIC/anon/authenticated privileges. The migration creates the table and applies its private permissions in one transaction, including when the project has default browser-role grants. Per-member transactions serialize creation and enforce the 20-view cap. Creation IDs support uncertain-request recovery; revisions protect update/delete operations. Lead listing continues through the existing RBAC service.

Verification uses fake provider credentials and mocked APIs. Six additional browser scenarios cover desktop/mobile CRUD and keyboard use, two-device reads, unavailable stages, uncertain-save/conflict recovery, and user/workspace/revocation boundaries. All 64 earlier browser scenarios and network/write guards remain required, for 70 total. A disposable cached PostgreSQL 17 container verified all 35 migrations, ownership/name constraints, RLS/ACL denial, revision comparison and membership cascade; it was removed afterward.

No new dependency, provider request, customer lead/task/email or widget activation is needed. Real-device sign-in and real saved-view writes are not used for verification. See the [rollback procedure](ops/saved-lead-views-rollback.md).
