# Flowrish staff waitlist inbox

Approved scope: a private inbox for Flowrish staff, signup-source attribution from the public receptionist demo, review/contact tracking, and explicit approval before CRM handoff.

## Access and privacy

- The waitlist is global. Organization administrator permissions alone never grant access.
- A server-managed `WaitlistStaffAccess` row grants a specific organization membership access. There is no customer-facing grant API. Removing membership removes the grant.
- Provision the existing Flowrish owner membership after verifying it, without hardcoded identities in application code. Other organizations and ungranted staff remain denied.
- Protect all reads and writes, including direct page/API requests. Enable RLS and revoke browser-role access on waitlist and staff tables.
- No public email existence checks, transcripts, or prospect details in marketing responses.

## Workflow

- Paginate 20 signups with an explicit review-state filter. Preserve the existing pending/invited/joined account status; add separate new/reviewed/contacted state with optimistic version checks.
- Marking contacted records work already done. It sends nothing.
- The public demo links to `/?source=receptionist-demo#waitlist`. Only the fixed public-demo/landing source values are accepted. Duplicate signups preserve first attribution and generic responses.
- Staff preview a link to an existing matching active lead or a new lead with a chosen open stage and organization member owner. Never pick a match automatically. Creating a new lead despite matches needs a separate acknowledgement.
- A fresh preview and explicit approval are required. Editing clears approval. Server rechecks access, source version, destination scope, and preview freshness in a transaction.
- A durable receipt permits only one CRM handoff per waitlist signup, including retries and deletion of the CRM target. Receipt references restrict destination-organization deletion; retirement must explicitly preserve or handle receipts. Existing leads and their owners are unchanged.
- A waitlist signup is not callback consent. This release creates no callback request, task, email, invitation, or provider request.

## Verification and limits

Use mocked providers, synthetic browser fixtures, and a disposable local PostgreSQL container. Never exercise mutations on real signups or leads. Keep the widget off and do not use DeepSeek. Run full unit tests, type checks, lint, guarded production build, browser rehearsal, and independent review before merging. Verify production with read-only checks.

Additional staff provisioning remains an operator action. Bulk actions, exports, email sending, automatic invitations, notes, and moving receipts between organizations are deferred. First-touch source is self-reported context, not verified identity or analytics.
