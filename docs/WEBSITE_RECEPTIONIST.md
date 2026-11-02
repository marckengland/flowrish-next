# Website receptionist

The website receptionist answers visitors on each organization's own website. Its business name and answers come from that organization's saved business details and approved library documents. Flowrish supplies the software; the assistant represents the organization's business.

## Enable on a business website

1. In **Settings → AI Receptionist**, save the business details.
2. Configure the organization's AI provider in Settings. Publish the relevant library documents and approve their current revisions for receptionist use.
3. Under **Website receptionist**, select **Load settings**. Enter each allowed website origin, including `https://`. Use exact origins, such as `https://example.com`; a subdomain needs its own entry.
4. Set daily message, reserved-token, and callback limits. Review the spending acknowledgement, enable the website assistant, and save.
5. Add the displayed script snippet to the allowed website. It contains only a public widget ID. Opening its launcher starts a short-lived chat; it does not use the visitor's Flowrish login.

The widget is disabled until an administrator explicitly enables it. The phone receptionist toggle is independent. Changing website settings invalidates existing website sessions.

## Spending and abuse limits

Website answers use only the organization's configured provider. They cannot fall back to a deployment-wide key. Each attempted answer reserves 9,656 units against the widget's daily token allowance, including failures. The default 20,000 allowance permits at most two attempted answers per UTC day, even though the default message limit is five. The organization's existing AI request and token limits also apply.

Each answer is limited to 9,000 input bytes, 400 output tokens, and an eight-second provider timeout. Chats last 30 minutes and allow six answers. Additional organization, IP, session-start, and callback caps apply. IP limits and the hidden spam field do not prove that a visitor is human; the organization-wide limits bound spending.

An ambiguous message request can be retried manually with the same request ID. A completed retry reuses its stored reply without another provider call. An expired in-flight lease closes the chat instead of generating again. The callback form remains available until the session expires.

## Callback requests

Visitors enter their name, phone number, and request in a separate form. They review the details and consent to contact before submitting. A successful submission records one pending callback request. It does not create a lead, task, appointment, email, or phone call.

Administrators select **Load callbacks** to review requests. They can mark a request reviewed, dismiss it, or explicitly delete it. **Prepare CRM handoff** opens matching leads and contacts, an owner/deadline form, and a task preview. Staff explicitly confirm before CRM work is created. Staff must arrange any contact separately. Confirmed callback requests remain until an administrator deletes them or the organization is removed.

Handoff matches international phone digits, including formatted numbers, within the current organization. It never silently picks among matches. Tasks require a lead: staff choose an existing active lead or create a lead in an existing open stage, optionally linked to a matching contact. Creating another lead when matches exist requires a separate acknowledgement. New leads receive the chosen owner; existing records and owners stay unchanged. Admin settings and CRM read/write permissions are required.

The preview shows the exact visitor details copied into CRM, the destination, owner, deadline and Medium priority. Editing the form clears approval. A changed request or destination requires a fresh review. A durable receipt prevents duplicate work on retries, even after source/CRM deletion. Select **Show callback source** on the task, then **Open source callback**. The receipt-backed link opens **Source callback handoff** in Settings; select **Prepare CRM handoff** to load its current details or receipt. Deleting a source callback does not delete its approved lead or task. Reassign or create later tasks through the normal CRM screens.

The service does not store visitor questions or conversation history. It retains only the latest public answer for retries, hashed session tokens and IP identifiers, and confirmed callback details. Scheduled cleanup removes sessions that expired over 24 hours ago and widget usage rows older than two UTC days. It preserves callback records and organization AI usage.

## Verification

Run the repository's full unit, lint, type, Prisma, and build checks. Additional suites use synthetic businesses and mocked AI:

```sh
npx vitest run --config vitest.website-receptionist.config.ts
npx vitest run --config vitest.callback-handoff.config.ts
npx playwright test --config playwright.website-receptionist.config.ts
PLAYWRIGHT_BASE_URL=http://localhost:3197 npm run test:e2e:prod -- e2e/website-receptionist-admin.spec.ts e2e/callback-handoff.spec.ts --retries=0
```

The PostgreSQL suite requires Docker and the local `pgvector/pgvector:pg16` image. It starts a disposable database and does not load production credentials. The isolated iframe suite requires neither an application server nor credentials. The admin suite requires an authenticated application target and mocks all widget settings, callback, and AI operations. Do not enable a production widget or call a real provider to run these suites.

Deferred: CAPTCHA, appointment booking, bulk CRM conversion, callback notifications, live phone service, and automatic callback deletion. Voice input remains in the authenticated browser test mode; the website widget uses typed questions.
