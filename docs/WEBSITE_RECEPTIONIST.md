# Website receptionist

The website receptionist answers visitors on each organization's own website. Its business name and answers come from that organization's saved business details and approved library documents. Flowrish supplies the software; the assistant represents the organization's business.

## Enable on a business website

For guided setup, open **Settings → AI receptionist → Open guided website setup**, or visit `/receptionist/setup`. The five steps save business identity and hours, prepare approved Library documents, configure exact websites and daily budgets, rehearse locally, and explicitly enable reception. Existing settings remain available below.

The saved-hours button only fills a new Library draft. Review, publish, and approve it before the website assistant can use those hours. Drafts and private phone notes are excluded. Business edits preserve phone routing and assignments; if phone reception is already enabled, the guide identifies that the shared business name and hours also affect it.

The rehearsal is a scripted simulation. It uses a complete excerpt from an approved publication, a greeting, fallback guidance, and fictional callback details. It calls no provider, places no call, and saves no CRM work. It does not prove AI connectivity, answer quality, or website installation. Final activation requires separate simulation and spending acknowledgements. Changed saved inputs or a fresh page require another simulation. Enabling permits real visitor traffic to spend provider credits.

Unsaved drafts require confirmation before changing steps, reloading, or following an application link. Browser Back/Forward uses a native discard prompt; declining restores the current page and can replace the browser's forward branch. Pending writes block client navigation until they finish.

1. In **Settings → AI Receptionist**, save the business details.
2. Configure the organization's AI provider in Settings. Publish the relevant library documents and approve their current revisions for receptionist use.
3. Under **Website receptionist**, select **Load settings**. Enter each allowed website origin, including `https://`. Use exact origins, such as `https://example.com`; a subdomain needs its own entry.
4. Set daily message, reserved-token, and callback limits. Review the spending acknowledgement, enable the website assistant, and save.
5. Add the displayed script snippet to the allowed website. It contains only a public widget ID. Opening its launcher starts a short-lived chat; it does not use the visitor's Flowrish login.

The widget is disabled until an administrator explicitly enables it. The phone receptionist toggle is independent. Changing website settings invalidates existing website sessions.

## Check the website installation

In guided setup, save the exact website origins in **Website & budget**, then open **Simulation**. Below the supplied script snippet, enter a public page URL and select **Check website installation**. The checker sends no traffic when you open the step. It does not load the widget, send an AI message, place a call, change settings, or enable reception.

Use an HTTPS page on a saved allowed website, without credentials, a query, a fragment, or a custom port. Each subdomain needs its own saved origin. A domain mismatch returns guidance without fetching the page. Redirects must remain within the saved websites; use the final public URL directly if a redirect is blocked.

**Matching snippet found in page source** means the standard absolute script URL and your current public widget ID match. Missing, wrong-ID, wrong-source, multiple-snippet, and unsupported-tag results explain what to replace. Copy the current snippet, publish the website, and check again. The checker does not return page contents, discovered foreign IDs, headers, IP addresses, or diagnostics.

This is a source check, not a browser execution or connectivity test. It cannot prove CSP compatibility, AI readiness, conversation quality, or JavaScript/tag-manager injection. Password protection, bot blocking, non-HTML/compressed responses, malformed/ambiguous source, and unusually large pages may need a manual browser check. Module and nomodule variants are not the supplied classic script installation.

The scanner also declines legacy frameset documents, nonstandard raw-text closing tags, and script tags with more than 256 attributes. Those cases receive manual-check guidance rather than a positive installation result.

Checks are limited to one per organization every 30 seconds. The website fetch stops after eight seconds, 512 KiB, or three redirects. Every connection uses a validated public DNS address pinned to that connection; private, local, special, mixed, and unsafe redirect destinations are blocked. Settings and administrator access are checked before and after fetching. Changed settings require reloading saved setup. Editing the URL or leaving the step clears/cancels the transient result; results are not saved. Installation results never replace the separate simulation and spending acknowledgements required to enable reception.

## Spending and abuse limits

Website answers use only the organization's configured provider. They cannot fall back to a deployment-wide key. Each attempted answer reserves 9,656 units against the widget's daily token allowance, including failures. The default 20,000 allowance permits at most two attempted answers per UTC day, even though the default message limit is five. The organization's existing AI request and token limits also apply.

Each answer is limited to 9,000 input bytes, 400 output tokens, and an eight-second provider timeout. Chats last 30 minutes and allow six answers. Additional organization, IP, session-start, and callback caps apply. IP limits and the hidden spam field do not prove that a visitor is human; the organization-wide limits bound spending.

An ambiguous message request can be retried manually with the same request ID. A completed retry reuses its stored reply without another provider call. An expired in-flight lease closes the chat instead of generating again. The callback form remains available until the session expires.

## Callback requests

Visitors enter their name, phone number, and request in a separate form. They review the details and consent to contact before submitting. A successful submission records one pending callback request. It does not create a lead, task, appointment, email, or phone call.

Administrators select **Load callbacks** to review requests. They can mark a request reviewed, dismiss it, or explicitly delete it. **Prepare CRM handoff** opens matching leads and contacts, an owner/deadline form, and a task preview. Staff explicitly confirm before CRM work is created. Staff must arrange any contact separately. Confirmed callback requests remain until an administrator deletes them or the organization is removed.

Handoff matches international phone digits, including formatted numbers, within the current organization. It never silently picks among matches. Tasks require a lead: staff choose an existing active lead or create a lead in an existing open stage, optionally linked to a matching contact. Creating another lead when matches exist requires a separate acknowledgement. New leads receive the chosen owner; existing records and owners stay unchanged. Admin settings and CRM read/write permissions are required.

The preview shows the exact visitor details copied into CRM, the destination, owner, deadline and Medium priority. Editing the form clears approval. A changed request or destination requires a fresh review. A durable receipt prevents duplicate work on retries, even after source/CRM deletion. Select **Show callback source** on the task, then **Open source callback**. The receipt-backed link opens **Source callback handoff** in Settings; select **Prepare CRM handoff** to load its current details or receipt. Deleting a source callback does not delete its approved lead or task. Reassign or create later tasks through the normal CRM screens.

## Track callback outcomes

Assigned staff can open **Tasks → Callback work queue** or **Track callback outcome** on the task. Organization administrators can also use the queue in **Settings → AI receptionist** or the tracker on a loaded handoff receipt. Loading and filtering are explicit. Staff see their assigned requests; admins see the organization’s requests. CRM read/write permission and current organization membership are required.

Record **Reached**, **No answer**, or **Needs another attempt**, with optional team notes. Select **Record result only**, **Reschedule existing task**, or **Close callback and complete task**, then preview and explicitly approve. Editing clears approval. Recording a result alone does not complete the task. Rescheduling reuses the same task, changes its owner/deadline, and explicitly reopens it if completed. Closing completes the task, marks an existing source callback reviewed, and closes the request lifecycle without closing the lead. A closed request is final in this workflow.

The overdue view shows unclosed requests with incomplete tasks whose deadlines have passed. Open requests also include tasks manually completed elsewhere, since task completion does not invent a call result or close the request. The queue shows 20 rows per page; history has latest/older pages of 20 outcomes. Results and notes are staff reports stored as CRM history; Flowrish places no call or message. Exact retries reuse one confirmation ID and cannot add duplicate events or notes. Changed tasks, requests or history require reloading and another review.

History survives source callback and CRM target deletion. A missing or inactive task/lead becomes read-only; it is never recreated. Closing after source removal resolves the retained request and existing task. Reassignment may remove the previous owner’s access; a successful confirmation remains acknowledged. Outcomes/history editing, bulk management, and reopening a closed request are outside this release.

The service does not store visitor questions or conversation history. It retains only the latest public answer for retries, hashed session tokens and IP identifiers, and confirmed callback details. Scheduled cleanup removes sessions that expired over 24 hours ago and widget usage rows older than two UTC days. It preserves callback records and organization AI usage.

## Callback notifications

The header bell opens **Notifications**. A scheduled check every five minutes alerts current organization administrators about pending website callbacks that have not been handed to CRM. Staff with CRM read/write access receive alerts for callback work currently assigned to them. Once its deadline passes, an overdue reminder replaces the assignment alert. The bell refreshes its unread count once per visible minute, on focus after that interval, and after a read action.

Notifications represent current actionable work. Refreshing hides requests already reviewed/dismissed or handed off, former assignments, changed deadlines, completed tasks, closed requests, unavailable leads/tasks and lost permissions. Each saved task version receives at most one assignment and one overdue alert. Saved task edits, including owner/deadline changes and reopening, can create a new version; reminders do not repeat every scheduled check.

Choose **Unread** or **All current alerts** and use **Mark read** explicitly. Reading an alert changes only your notification; it never reviews a request, contacts a visitor, creates CRM work, completes a task or records an outcome. Opening a link does not mark it read. Notification records contain source identifiers and timestamps, and keep read/deduplication state after their source becomes inactive. Removing an organization membership deletes its notifications. There is no email, SMS, push or AI delivery, and reads never create alerts.

## Callback response targets

Open **Settings → AI receptionist → Manage callback response targets**, or **Notifications → View callback response targets**. Targets are off until a settings administrator enables them, selects a current manager with settings and CRM read/write access, and approves applying the policy to waiting work.

Set separate targets for CRM handoff and first recorded contact. Defaults are 60 and 120 business minutes. Enabling or editing adopts the current saved timezone, opening days, and same-day opening interval. The policy retains that snapshot when business settings change. Explicitly save the changed hours to recalculate waiting deadlines. Pausing remains available if saved hours become invalid or the manager leaves.

The handoff clock starts when a visitor confirms a callback. Pending requests leave this phase when reviewed, dismissed, deleted, or handed to CRM. The contact clock starts at approved CRM handoff. **Reached** or **No answer** satisfies contact; **Needs another attempt** and manual task completion alone do not. Reassignment and rescheduling do not restart the clock. Closing the callback or losing an active CRM destination removes eligibility. Deleting the source callback after handoff preserves the retained CRM obligation.

The queue supports missed targets or all waiting work, with 20 rows per page. Current permissions limit the displayed work. A separate check every five minutes calculates deadlines and sends deduplicated in-app escalations to the selected manager. Refresh to see new results. Policy changes invalidate previous flags until the next successful check. Escalation never creates or reassigns CRM work, contacts visitors, completes tasks, or records outcomes.

Business minutes exclude closed days and hours and account for daylight-saving changes. The weekly schedule has no holiday overrides or overnight openings. Targets range from 5 to 1,440 minutes and cannot exceed 52 nominal weeks of opening minutes. Calendar searches stop after 400 local dates; unusually short schedules around skipped openings may require a shorter target. Manager selection and policy acknowledgement require administrator action; deploying this feature does not enable it.

## Receptionist home

Open **Receptionist** in the sidebar or **Settings → AI receptionist → Open Receptionist home**. Current organization membership and either Settings permission or both CRM read/write permissions are required. The page rechecks local permissions and loads one read-only snapshot. **Refresh receptionist home** loads another snapshot; it does not poll.

Settings administrators see saved business details, organization AI configuration metadata, current approved public documents, saved website limits/origins, and pending CRM handoffs. CRM members see open and overdue callback work; administrators with CRM access see the organization totals, and other members see their current assignments. Sections without permission are hidden. A manually completed task still represents open callback work until the callback lifecycle closes, but it is no longer overdue. Approved CRM work survives deletion of its source callback.

Saved setup prerequisites and the website's On/Off switch are separate. This summary does not retrieve or decrypt an AI key, verify credits or connectivity, inspect an installed widget, or enable reception. Deployment-wide credentials, private phone notes, drafts, and obsolete public approvals do not satisfy website prerequisites. **Check website installation** opens the existing manual checker; it performs no check automatically and cannot replace the simulation and launch acknowledgements.

Missed flags use the current enabled response policy, existing calculated deadlines, live source eligibility, and current assignments. A paused policy hides missed flags. The page shows the last successful target check, or that the first check is still pending; zero flags are not proof that every target was met. Reads do not calculate deadlines or send notifications.

Tool links open existing setup, Library, callback approval, work queue, response-target, notification, and performance workflows as permissions allow. Callback handoffs, results, and launch retain their existing human review steps. Installation history, live provider health, and historical daily activity are outside this home page.

Rollback: revert the home-page merge with `git revert -m 1 <merge-commit>`, then deploy normally. This release changes no schema, settings, permissions, background jobs, or business records, so there is no data rollback. Do not restore a database snapshot or rewrite main's history.

## Receptionist callback inbox

Open **Receptionist → Review callback requests**, or **Settings → AI receptionist → Open callback inbox**. The dedicated inbox requires current organization membership and Settings permission. CRM staff without Settings access continue to use their assigned callback work queue.

Select **Load callback requests** to read confirmed visitor requests. Choose Pending, Reviewed, Dismissed, or All, then reload explicitly to apply the filter. Pagination follows the loaded filter, with up to 20 records per page. Opening the page does not fetch requests or load business, provider, spending, or embed settings.

The inbox and Settings share the same callback controls. Reviewing or dismissing a request does not contact its visitor or create CRM work. **Prepare CRM handoff** loads existing choices or a retained receipt, where available leads and tasks can be opened. Creating CRM work still requires CRM and contacts access, a preview, an approval checkbox, and **Confirm CRM handoff**. Changed choices invalidate the previous preview. Permanent deletion retains its separate confirmation and does not delete an approved CRM lead or task.

There are no new callback APIs, background jobs, provider calls, or automatic approvals. Configuration remains in Settings and guided setup.

## Visitor feedback and FAQ drafts

Open **Receptionist → Visitor feedback**, or **Settings → AI receptionist → Review visitor feedback**. Current organization membership and Settings permission are required. Load feedback settings explicitly, then acknowledge question saving before enabling it. Feedback is off by default, and changing it resets active chats without enabling website reception. Ordinary website saves retain the separate feedback setting.

An opted-in session shows **This didn’t help** after an answer. The form explains that question copies in FAQs can remain after report expiry/deletion. Opening it does not save anything. The visitor can remove personal information, then must agree to save the reviewed question. Editing clears that agreement. Feedback contains the submitted question, allowed website origin and server consent time; it is not a verified transcript and includes no answer, contact details or full conversation.

Saving uses the current session and answered-request ID. There is at most one report per answered request and a fifty-report organization limit per UTC day, tracked separately so deleting reports does not restore the allowance. Text-free daily counters are removed after two UTC days. Retrying the same reviewed text does not create another report or call AI. Closing an unresolved retry stops further attempts and explains that the earlier request may already have saved. The callback form remains independent.

Administrators explicitly load Open, Dismissed or All reports, with twenty rows per page. Reports expire from review after thirty days and are removed during daily cleanup. Administrators can dismiss/reopen a report or permanently delete it after confirmation. An opaque session receipt prevents a deleted report from reappearing on a late public retry; it contains no question text and expires with ordinary session cleanup.

**Create FAQ draft** copies a question into a private Library draft with an empty answer. It reuses an existing draft on retries and shares the fifty-active-document Library limit. Add and verify an answer in Library, remove any unsuitable visitor text, then publish and approve separately through the existing workflow. These explicitly created documents remain after feedback expiry/deletion. Feedback actions never generate answers, publish, approve, create CRM work, contact visitors or spend AI credits.

Visitor reports stay separate from the rehearsal knowledge-gaps inbox. Semantic grouping, automatic answers and publication are outside this release. The [rollback procedure](ops/visitor-feedback-rollback.md) preserves expiry even when the feature is disabled.

## Receptionist performance

Open **Settings → AI receptionist → View receptionist performance**, or use the same link on **Callback response targets**. The dashboard requires current organization membership with Settings and CRM read/write permissions. It reads existing records and never calls a provider, contacts a visitor, approves a handoff, records a result, calculates new targets, or creates notifications.

Choose inclusive UTC request dates and select **Apply filters**. The default covers 30 dates including today; the maximum is 366. Owner filters use current CRM ownership after any reassignment. **No CRM handoff** selects requests without an approved handoff. The selector lists up to 200 current organization members. Former or foreign owners' names are excluded.

The milestone bars count available requests, approved CRM handoffs, recorded contact, and closed callbacks independently. Later results count toward the selected request cohort as of the displayed observation time. Closing does not imply contact or a sale. Reached or No answer after handoff counts as contact; Retry, task completion, and closure alone do not. Latest-result totals count one last staff-reported result per handoff, even when an earlier contact satisfies the contact milestone.

Select a milestone, waiting-work tile, or record view to inspect its records. Drilldowns show 20 rows per page without changing the totals above. Available task links open the existing CRM workflow. Missing, closed, or deleted CRM destinations preserve historical milestones but have no task link or active waiting-contact flag. Pending handoffs and waiting contact with an unavailable owner count as work without a current CRM owner.

Response-time figures are medians of valid elapsed minutes with sample counts. They include closed hours and weekends and are distinct from business-minute response targets. Missed flags use the current enabled policy and live source eligibility. Paused or changed policies hide obsolete flags; check the displayed last-success time before interpreting zero flags.

Deleted requests leave the request-date cohort because their original creation time is not retained. Their durable CRM handoffs appear separately, selected by handoff date, with a separate drilldown and missed-contact count. Historical owner attribution, deleted-request date reconstruction, sales/revenue conversion, export, and automatic report delivery are outside this release.

## Verification

Run the repository's full unit, lint, type, Prisma, and build checks. Additional suites use synthetic businesses and mocked AI:

```sh
npx vitest run --config vitest.website-receptionist.config.ts
npx vitest run --config vitest.receptionist-setup.config.ts
npx vitest run --config vitest.callback-handoff.config.ts
npx vitest run --config vitest.callback-outcomes.config.ts
npx vitest run --config vitest.callback-notifications.config.ts
npx vitest run --config vitest.callback-response.config.ts
npx vitest run --config vitest.callback-performance.config.ts
npx vitest run --config vitest.receptionist-home.config.ts
npx vitest run --config vitest.visitor-feedback.config.ts
npx playwright test --config playwright.website-receptionist.config.ts
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/website-receptionist-admin.spec.ts e2e/callback-handoff.spec.ts e2e/callback-outcomes.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/receptionist-setup.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/receptionist-installation.spec.ts e2e/receptionist-installation-smoke.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/receptionist-home.spec.ts e2e/receptionist-home-smoke.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/receptionist-callback-inbox.spec.ts e2e/receptionist-callback-inbox-smoke.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/visitor-feedback-admin.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/callback-notifications.spec.ts e2e/callback-notifications-smoke.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/callback-response.spec.ts e2e/callback-response-smoke.spec.ts --retries=0
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/callback-performance.spec.ts e2e/callback-performance-smoke.spec.ts --retries=0
```

The PostgreSQL suite requires Docker and the local `pgvector/pgvector:pg16` image. It starts a disposable database and does not load production credentials. The isolated iframe suite requires neither an application server nor credentials. The admin suite requires an authenticated application target and mocks all widget settings, callback, and AI operations. Do not enable a production widget or call a real provider to run these suites.

Deferred: CAPTCHA, appointment booking, bulk CRM conversion, email/push delivery, live phone service, and automatic callback deletion. Voice input remains in the authenticated browser test mode; the website widget uses typed questions.

## Demo mode

Open Receptionist home and choose **Demo mode** to practice without live AI or phone requests. The server checks current organization Settings or CRM access and reads only the saved business identity/hours and bounded excerpts from current, published, receptionist-approved services and pricing documents. Drafts, private phone notes, stale approvals, and AI credentials are excluded from the page data.

The conversation uses prewritten rules for services, pricing, hours, callback requests, and unknown questions. It does not evaluate an AI model. Use fictional callback details. Review the readback and confirm consent, then separately preview and approve the simulated lead/task and callback outcomes. Correcting callback details invalidates consent. Changing an outcome invalidates its approval. Repeated confirmation does not duplicate the simulated action.

Everything entered in Demo mode stays in page memory. Restart or reload to clear it. The page shows the latest 40 messages and 20 outcomes. It does not save a rehearsal report, submit a callback, create CRM records, change owners/deadlines, place calls, or change the website switch. Approved excerpts are rendered as plain text. Missing information is left for the team to confirm.

Rollback for this feature is an ordinary code revert. There are no migrations, new dependencies, or configuration/data changes to undo. Live AI quality, microphone behavior, and telephone connectivity are outside this demo.

## Preferred callback times

Visitors can optionally request a callback time in the saved business timezone, within weekly opening hours and the next 90 days. Opening time is included; closing time is excluded. The form shows the timezone and includes the selected local time in its consent readback. Changing a field clears consent. Times affected by a missing or repeated daylight-saving clock hour are rejected. The server rechecks the saved calendar version, future time, and hours before consuming callback quota or saving the request.

Staff see the original requested time in the inbox and CRM handoff. Confirm the request or select another business-local time, then preview and approve the task. The task deadline stores the staff-approved UTC instant. Rescheduling through callback outcomes uses the same business-hours validation and approval. A business-hours change invalidates an earlier preview. Untimed callbacks keep their existing deadline controls.

The original requested UTC instant, timezone, local readback, and business version remain on the callback and durable handoff receipt. Removing a source does not erase that request snapshot from approved CRM work. Timed first-contact response targets start at the later of handoff creation and the staff-confirmed task deadline; existing reconciliation updates targets after a reschedule. Untimed target rules are unchanged.

Timed submissions freeze the full reviewed payload for retries. A matching retry does not consume more quota or recreate a removed source; changed timed retries require a new chat. Calendar-version conflicts require a fresh session and readback. Old embeds and sessions continue supporting untimed requests. Error text uses an allowlist and never displays server diagnostics.

Demo mode rehearses preferred, confirmed, and rescheduled times in page memory. It makes no provider or mutation requests. A requested time requires staff confirmation and does not reserve an appointment. Holidays, overnight hours, staff capacity, external calendars, and automatic booking are not modeled. See [preferred-time rollback](ops/preferred-callback-time-rollback.md) for the additive-schema recovery procedure.
