# Set up the AI receptionist

The receptionist answers incoming Twilio calls, uses your approved business information for questions, and collects a callback message. It reads the name, phone number, and request back to the caller. Only an explicit confirmation creates a lead, call activity, and callback task.

## Prepare the application

1. Apply the pending Prisma migrations through your normal deployment process. The new migration is `20261102020000_add_ai_receptionist`.
2. Generate the Prisma client with `npx prisma generate` and deploy the application.
3. Open **Settings → Calling & voice**. Save the organization's Twilio credentials, including the **Auth Token** and the incoming number in international format.
4. Open **Settings → AI receptionist**. Add the business name, approved FAQ answers, callback owner, and an open pipeline stage.
5. Set the business time zone, opening and closing times, and working days. Callback tasks are due at the next business opening. If a daylight-saving transition skips that opening time, the task is due at the first valid business minute that day.
6. Choose **After business hours** and enter a different daytime forwarding number, or choose **Every incoming call**.
7. Enable the receptionist and save.

The feature starts disabled. It uses the existing AI provider configuration and adds no new package dependencies.

For local database verification, run `npm run test:receptionist:integration`. This uses a disposable Docker container and never connects to your configured database. Docker must already have the `pgvector/pgvector:pg16` image; the test does not pull it.

## Connect an incoming number

In the Twilio Console, open the phone number that matches the stored incoming number. Under its incoming voice configuration, set **A call comes in** to **Webhook**, paste the URL from the receptionist settings, and choose **HTTP POST**. The URL has this shape:

```text
https://your-app.example/api/voice/receptionist/ORGANIZATION_ID
```

Keep the existing `/api/voice/twiml` URL on the TwiML App used for outgoing browser calls. The receptionist endpoint is separate.

Twilio and your AI provider charge for usage. The webhook uses Twilio's [Gather](https://www.twilio.com/docs/voice/twiml/gather) and [Say](https://www.twilio.com/docs/voice/twiml/say) verbs, so callers hear pauses between turns.

## Verify the complete flow

Call the incoming number outside the configured business hours, or temporarily choose **Every incoming call**.

1. Confirm that the greeting identifies the AI receptionist and the correct business.
2. Ask a question covered by the supplied FAQ, then one the FAQ does not answer. The receptionist should offer a callback for the unanswered question.
3. Give a name and callback request. Correct the phone number during readback. It must read the revised details back before saving.
4. Say **yes**, or press **1**. A lead, CALL activity with the conversation, and assigned callback task should appear. The task should be due at the next business opening.
5. Call again without confirming. Review the conversation in **Recent receptionist calls**; it must not create a callback task.
6. In after-hours mode, call during business hours and verify forwarding to the configured team number.

Only one active lead with the exact stored international phone number is reused. Ambiguous matches create a new lead rather than attaching the conversation to an arbitrary record. Existing leads with differently formatted numbers are not merged automatically.

## Failure behavior and access

- Missing or invalid Twilio signatures, a mismatched Twilio account, and a mismatched destination number are rejected before the AI runs.
- The public-call AI receives the approved business information and this call's messages. It receives no CRM records or action tools.
- Provider errors switch to structured message collection. A rejected correction clears the old details before collecting them again.
- Two empty responses, twelve conversational turns, or an expired session end the call without a confirmed callback.
- Confirmation uses one database transaction for the lead, activity, task, audit entries, and call outcome. Retried or concurrent deliveries of the same call turn cannot create a second callback.
- Only users with `admin:settings` can configure the receptionist or read its recent call conversations. The two new tables have row-level security enabled and no public Data API policies.
- A caller hanging up early may remain **In progress** for up to one hour before the settings panel displays **Not finished**. Reopen the panel to refresh recent calls.

Transcripts persist in the call record and, for confirmed callbacks, the lead's activity. This release does not record audio or automatically delete transcripts.

## Disable or roll back

Turn off **Enable AI receptionist** and save. Change the Twilio number's incoming webhook back to its previous handler if you need to restore the old call flow. To roll back the application code, keep the additive tables so call history and configuration survive. Disabling does not require the saved callback owner or pipeline stage to still exist.

The [rollback runbook](AI_RECEPTIONIST_ROLLBACK.md) records the before state, scoped disable statement, code rollback, and database recovery checks.

This release does not include appointment booking, email sequences triggered by calls, streaming voice, live transfers during an AI conversation, holiday exceptions, or overnight opening hours. English speech is used for this first version.
