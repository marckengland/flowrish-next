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
2. Enter what a caller would say in **Caller message**, or use the microphone as described below.
3. Choose **Send caller message**.
4. Ask an approved business question, then a question your information does not answer.
5. Give a test name, callback number with country code, and reason for calling.
6. Review the readback. Correct any details before confirming.
7. Choose **Press 1 to confirm** or send **yes**.

The result shows a **Preview-only callback summary**. No lead, task, activity, call record, audit entry, saved transcript, or callback appointment is created by preview requests. The browser holds the conversation until you reset it, change settings, leave the panel, or close the page. Admin-only source labels identify references used for the latest answer.

Choose **Reset preview** for a new conversation or **End preview** to stop. If another administrator saves settings during your test, start again with the new saved configuration. Knowledge is retrieved fresh on each AI turn. An answer already in progress cannot be recalled after a source is revoked.

## Listen to replies

Optionally select **Read replies aloud**. It starts off and uses the browser's speech synthesis. If speech playback is unavailable, the text conversation still works. Stopping the preview, changing settings, leaving the panel, or clearing the checkbox cancels playback.

## Speak a caller message

1. Start a preview and choose a **Recognition language**.
2. Choose **Use microphone** and allow the browser permission prompt.
3. Speak one message, then pause or choose **Stop microphone**.
4. Review the text in **Caller message**, especially names and phone numbers. Edit it if needed, then choose **Send caller message**.

Dictation never sends a message automatically. Interim text appears under **Hearing**; only final recognized text enters the message field. **Cancel microphone** stops listening and discards interim text. Final text already recognized remains available for review. Listening also stops when you end the preview, switch tabs, leave the page, or change settings. Listening is limited to 30 seconds, followed by up to five seconds to finish recognition. The combined message is limited to 2,000 characters.

Starting the microphone stops read-aloud playback. After dictation ends, **Read replies aloud** can speak the next reply. Listening never restarts automatically.

Speech recognition needs a supported browser and HTTPS or localhost. If the API is absent, permission is denied, or the recognition service fails, continue with typed input. The [browser's speech service](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) may send audio for processing and may require a network connection. Flowrish does not upload or store microphone audio. It receives the text only after you choose Send, using the existing preview and AI provider.

Browser testing adds no Twilio charges and places no phone call. Existing AI usage rules still apply. Use synthetic business and caller details when testing.

## Connect a phone later

Use the [phone setup guide](AI_RECEPTIONIST.md) when a voice account and incoming number are available. Keep phone activation separate from browser testing. A real call is still required to verify greeting playback, speech recognition, provider webhook delivery, forwarding, and caller confirmation over the phone.

The [competitor comparison](RECEPTIONIST_COMPETITORS.md) explains the setup patterns used here. The [rollback notes](ops/RECEPTIONIST_PREVIEW_ROLLOUT.md) describe verification and recovery.

## Verify native speech without a physical microphone

The opt-in `scripts/test-receptionist-native-microphone.ts` harness uses installed Google Chrome and an existing authenticated browser test state. Supply a synthetic English WAV saying “How much does a basic bicycle tune-up cost?” with two seconds of leading silence. Set `E2E_NATIVE_MIC=1`, `E2E_MIC_AUDIO_FILE` to its absolute path, and `PLAYWRIGHT_BASE_URL` to the app under test, then run the script through Node 22 with `--env-file=.env --import tsx`.

The harness denies physical microphone permission and checks that denial before passing the synthetic audio track to Chrome's native recognizer. Recognition events and transcripts are real. Settings and AI replies use fixtures, so this test creates no business records and uses no AI or Twilio requests. The separate live-AI harness verifies the provider conversation. A native test pass does not prove a physical microphone, all supported languages, or phone audio quality.

The November 2 local native run recognized the full sample question, required an explicit Send, and made zero voice requests. Automated unit and browser tests separately cover unavailable recognition, blocked permissions, retry controls, stale events, and cancellation.

The hosted combined check on `eb7cc5e` also recognized the synthetic question with physical microphone permission denied, sent that exact transcript after an explicit Send, and received the real AI answer of PHP 750. Four conversational AI turns succeeded. Gemini then returned a rate limit, and a later spaced retry was also rate-limited. Those runs are recorded as failures of the complete seven-turn acceptance check. Both removed their exact sample setup and restored the original CRM counts; no voice endpoint was called.
