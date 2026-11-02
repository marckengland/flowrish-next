# Conversation-based follow-up drafts

In **Follow-up inbox**, select an email follow-up, optionally enter **Draft instructions**, and choose **Generate contextual draft**. Flowrish retrieves the source conversation from the connected Gmail or Microsoft mailbox and asks the configured AI provider to draft a reply. Generation is on demand and requires the existing AI plan entitlement and lead read/write permissions.

The result shows its message count, mailbox, recipient and generation time. Choose **Review email draft**, edit the reply, then choose **Send reply** when ready. Generating a draft, opening the editor and approving a task never send email. Contextual replies do not offer the separate test-email action or generic prospect-email generator. Regenerating an open draft requires a replacement choice; failed generation preserves the open editor.

## Context and access

The full text of the source conversation is fetched directly from the current user's connected mailbox. The source message must match the follow-up, lead primary/alternate address, mailbox and provider thread. Copied participants are retained. Attachments and linked documents are excluded; no external links or images are fetched.

The provider adapter prefers Gmail plain MIME text, handles inline text body payloads and HTML-only messages, and pages Microsoft Graph conversations. Conversations exceeding 100 messages, 100,000 text characters or the response-size budget fail visibly instead of silently using a preview. Retrieval has a 25-second overall budget and a bounded refresh-token wait. A late legacy credential refresh may finish after a retrieval timeout; it cannot send email or apply a draft.

Email content is treated as untrusted context, never as system instructions or tool requests. The configured AI provider receives conversation text only when the user requests generation. Full provider message bodies are not copied into Flowrish's database or logs. Flowrish stores the generated outbound draft and metadata: version, timestamp, source mailbox/thread/recipient, count and a content fingerprint.

## Sending and stale drafts

The final send validates current membership, permissions, lead access, draft version and source conversation again. If the conversation changed after generation, generate a new draft before sending. The server selects the original mailbox and verified recipient; client mailbox overrides are ignored. Gmail requires valid RFC reply headers, and Microsoft replies fail closed if the source conversation cannot be found. There is no automatic fallback to a new conversation for these generated replies.

Checking freshness is a point-in-time operation; a message arriving after that check cannot recall an email already handed to the provider. Repeated user sends are not advertised as exactly-once delivery. Real emails are never sent by automated tests.

## Verification and rollback

Base commit: `179ac42`. The forward migration adds three nullable draft metadata fields and changes no provider credentials or customer messages. Retain those columns and saved drafts when reverting the feature code. Revert the feature merge and deploy the previous app; never drop mailbox history or restore the whole database to undo this feature.

The previous app renders saved draft text as a manual new-email template and cannot enforce the new mailbox/thread/version binding. If rolling back after generated drafts exist, pause review/sending from the old inbox until users check the recipient and mailbox manually. No rollback automatically sends mail. Generated drafts remain subject to the old explicit Send action.

Run `npm test`, `npm run lint`, `npm run typecheck:fast`, `npm run build`, and `node_modules/.bin/vitest run --config vitest.follow-up-drafts.config.ts`. The mailbox-sync, follow-up and receptionist PostgreSQL suites remain regression checks.

Reply subjects are derived from the verified source thread rather than the AI's suggested title. Changed subjects are rejected on send so the reply remains in its conversation. Empty or invalid source subjects require manual handling in the mailbox. Disconnecting or replacing the source mailbox invalidates source-bound drafts; the old draft does not silently switch to a different account.

Rollout baseline: 10 leads, 7 tasks, 9 activities, 1 mailbox, 0 follow-up suggestions. The metadata migration changed no customer records or credentials. The separate automatic mailbox sync continued ingesting new messages during development (9 messages at the baseline, 10 at the post-migration check); the draft migration does not insert email messages.

Rollback reverse-patch verification passed on a disposable archive: every tracked file hash matched the base afterward. Final local checks passed: 1,104 unit tests, 27 PostgreSQL integration tests, lint, both typecheck engines and production build. Browser suite: 28 passed with four legacy navigation selector guards skipped. The final affected browser recheck passed all six checks.
