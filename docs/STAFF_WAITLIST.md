# Review Flowrish waitlist interest

The waitlist inbox is for explicitly authorized Flowrish staff. It is not available to customer organization administrators. After an operator grants access to your exact organization membership, open **Admin → Flowrish waitlist inbox** or `/staff/waitlist`.

## Review signups

The inbox shows 20 signups per page. Filter by **New**, **Reviewed**, **Contacted**, or **All signups**. Signup source distinguishes the homepage from the public receptionist demo link. Source records the first signup's fixed context; it is not verified identity or visitor analytics. Duplicate submissions do not replace the original source or reveal whether an email already exists.

Select **Mark reviewed** after checking a signup. Select **Mark contacted** only to record contact you already made separately. These controls send no message. Review state is separate from the existing pending/invited/joined account status; reviewing a signup never invites an account.

If another staff member changes a signup, reload it before editing again. Reloading also refreshes pagination and filters.

## Approve a CRM handoff

1. Select **Prepare CRM handoff**. Current CRM read/write permissions are also required.
2. Choose an existing matching active lead, or create a new lead with a first name, open stage, and organization member owner. Matches use the signup email against primary/alternate lead emails without case sensitivity. No match is selected automatically. If matches exist, creating another lead requires a separate duplicate acknowledgement.
3. Select **Preview CRM handoff**. Check the destination organization, copied email, lead name, and chosen owner/stage. Linking an existing lead preserves its details and ownership.
4. Select **I approve this CRM handoff**, then **Confirm CRM handoff**. Any form correction clears the preview and approval.

A signup can be handed to CRM only once. The saved receipt links to the lead while it remains available. If that lead is later removed, the receipt remains and the inbox cannot recreate it. This handoff creates or links a lead only. A waitlist signup does not provide callback consent: no callback request, task, email, or account invitation is created.

If confirmation is uncertain, use **Reload handoff** to look for the receipt before retrying. Do not start another signup or use another destination to work around a recorded handoff.

## Not included

There are no bulk actions, exports, notes, automatic outreach, invitation controls, receipt reassignment, or app-based staff provisioning in this release. Verification uses synthetic records and mocked provider/email responses. It does not exercise live outreach or AI.
