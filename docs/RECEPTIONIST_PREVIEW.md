# Set up and test a receptionist before connecting a phone

Open **Settings → AI receptionist**. The setup list guides you through business details, approved knowledge, a browser conversation, and optional phone connection.

## Save your business details

1. Enter the business name callers should hear. **Greeting preview** updates as you type.
2. Set the business time zone, hours, and working days.
3. Choose the callback owner and an open pipeline stage.
4. Keep **Enable AI receptionist** off while preparing the setup.
5. Choose **Save receptionist settings**.

The saved business name belongs to this workspace's receptionist. It can differ from the workspace name. Conversations use saved settings, so save edits before starting a preview.

## Add answers for callers

Add approved information in **Business information and FAQs**, or use **Knowledge library** to upload documents. Library documents must be published and separately approved for the receptionist. Private drafts and Airish-only publications are excluded from preview and caller answers.

Choose **Check saved setup** to see the current approved-document count, saved FAQ presence, and phone-credential presence. Credential presence does not prove that incoming phone routing works. If no business information is available, test greeting and callback collection instead of expecting answers about services or prices.

## Run a browser conversation

1. Choose **Start browser preview**.
2. Enter what a caller would say in **Caller message**.
3. Choose **Send caller message**.
4. Ask an approved business question, then a question your information does not answer.
5. Give a test name, callback number with country code, and reason for calling.
6. Review the readback. Correct any details before confirming.
7. Choose **Press 1 to confirm** or send **yes**.

The result shows a **Preview-only callback summary**. No lead, task, activity, call record, audit entry, saved transcript, or callback appointment is created by preview requests. The browser holds the conversation until you reset it, change settings, leave the panel, or close the page. Admin-only source labels identify references used for the latest answer.

Choose **Reset preview** for a new conversation or **End preview** to stop. If another administrator saves settings during your test, start again with the new saved configuration. Knowledge is retrieved fresh on each AI turn. An answer already in progress cannot be recalled after a source is revoked.

## Listen to replies

Optionally select **Read replies aloud**. It starts off and uses the browser's speech synthesis. If speech playback is unavailable, the text conversation still works. Stopping the preview, changing settings, leaving the panel, or clearing the checkbox cancels playback.

This preview does not use a microphone, record audio, place phone calls, or exercise speech recognition. It adds no telephony charges. Requests use the existing AI provider, whose usage rules still apply. Use synthetic details for tests when you do not need to send real caller data to that provider.

## Connect a phone later

Use the [phone setup guide](AI_RECEPTIONIST.md) when a voice account and incoming number are available. Keep phone activation separate from browser testing. A real call is still required to verify greeting playback, speech recognition, provider webhook delivery, forwarding, and caller confirmation over the phone.

The [competitor comparison](RECEPTIONIST_COMPETITORS.md) explains the setup patterns used here. The [rollback notes](ops/RECEPTIONIST_PREVIEW_ROLLOUT.md) describe verification and recovery.
