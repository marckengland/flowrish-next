# Test the receptionist with a live AI provider

Normal unit tests and `npm run test:receptionist:mocked` use synthetic responses. This optional procedure spends real provider allowance and temporarily saves synthetic setup records. Obtain explicit authorization and agree on a provider and request budget before running it.

## Prepare an isolated installation

Use Node 22, your own database, an authenticated synthetic administrator, and an AI provider configured for that workspace. Keep website and phone reception disabled. Never use another organization's saved credentials or increase its limits to make a test pass.

The harness refuses to overwrite a saved receptionist configuration and expects an empty Library and no voice configuration. Use a dedicated test workspace. Refresh its browser test authentication through the normal E2E setup, then opt in explicitly:

```sh
PLAYWRIGHT_BASE_URL=https://your-test-app.example npm run test:e2e:prod -- --project=setup
E2E_LIVE_AI=1 PLAYWRIGHT_BASE_URL=https://your-test-app.example node --env-file=.env --import tsx scripts/test-receptionist-live-ai.ts
```

The example host is a placeholder; replace it with your authorized test installation. The harness loads credentials from your private environment. Do not paste credentials into command arguments or public logs.

## Review the conversation and diagnostics

Check the business greeting, an approved price, unknown-service handling, private-draft exclusion, revoked-source exclusion, corrected callback details, and explicit confirmation. Conversational turns report AI or fallback mode. A fallback is not a successful live AI answer. Confirmation is deterministic and makes no additional AI request.

Inspect exact callback name, number, and latest reason. Confirmation produces only a preview summary; it must not create customer calls, leads, tasks, or appointments. Admin diagnostics use bounded error categories rather than raw provider output.

The harness writes a private report and a fixture journal under the operating system's temporary directory. Keep those files and browser authentication out of Git and public artifacts. A successful local run does not establish hosted provider quality, microphone quality, or telephone routing.

## Verify cleanup

The harness claims only its exact disabled configuration and documents, using their saved versions. If an administrator edits them concurrently, cleanup refuses to remove the changed records. Inspect the reported cleanup result before repeating a run. Setup audit entries remain intentionally.

Confirm that customer-record counts, provider settings, and disabled reception state are unchanged. Remove only verified test-owned fixtures. Do not restore a whole database, overwrite existing settings, or delete records merely because a previous run created similarly named data.

For zero-provider workflow testing, use the [mocked rehearsal](../TESTING.md). Native browser dictation and real phone tests have separate requirements in the [preview guide](../RECEPTIONIST_PREVIEW.md).
