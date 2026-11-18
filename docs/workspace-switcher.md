# Switch businesses

Choose a business from the selector near the top of the sidebar. On mobile, open navigation first. The selector lists businesses you already belong to. It grants no new membership or permission.

Switching reloads the dashboard, clears cached workspace data and saved lead filters, and forgets the previous Airish conversation pointer. Save your edits first. Theme and table display preferences remain. The business name in the header and its available navigation reflect the selected business and your current roles there.

The selection belongs to the current signed-in account in this browser. It does not change the account's default business on other devices. Open tabs move together. A stale request is rejected before it can write into the newly selected business, even if another tab missed the change notification.

If access changes or a switch cannot be confirmed, use **Choose a business** at `/workspaces`. Choose an available business to reload current access. Flowrish never automatically repeats an uncertain selection request. If you have no memberships, ask an administrator for access.

## Mailbox connections during a switch

Gmail and Outlook consent must finish in the same business and signed-in account where it began, within ten minutes. If you switch first, start the connection again in that business's Settings. Consent windows opened before this release also need to restart.

Only one pending consent attempt per provider is supported. Concurrent or old consent windows can invalidate a newer attempt and require another attempt. They cannot attach credentials to a different business.

## Verification and limits

Workspace membership, permissions, stale requests, cookie handling, and mailbox callbacks are tested with mocked identities and providers. The isolated browser rehearsal covers selection, cache cleanup, other tabs, and recovery on desktop and mobile with synthetic records. It imports no production authentication or database client.

No real business selection, mailbox connection, provider request, email, or CRM record is needed for verification. Independent businesses in separate tabs, preserving unsaved drafts across switches, creating businesses, and onboarding accounts with existing memberships are outside this release.

For recovery, hide the sidebar selector while retaining the session/request guards, recovery chooser, and mailbox OAuth state validation. Existing browser selections and consent windows can outlive a deployment. A blanket revert could retarget their requests to the account's default business. Prepare and test a selective recovery patch against your release; keep its operational evidence outside the public repository. No database restore or membership rewrite is required.
