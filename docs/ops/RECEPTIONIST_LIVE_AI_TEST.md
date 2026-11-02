# Test the browser receptionist with a live AI provider

## Before state

On November 2, 2026, base app `e6ebd78` had 10 leads, 7 tasks, 9 activities, zero receptionist configurations, zero receptionist calls, zero voice configurations, and zero knowledge documents. The live test uses only synthetic bike-repair business details and fictional callback numbers.

The test temporarily saves a disabled sample receptionist and creates sample knowledge documents. No incoming number or Twilio credentials are added. A `finally` cleanup removes only the exact test-owned configuration and document records, checking their business name, content, and saved version. Setup audit entries remain as a record of the actual test actions. Customer records and pre-existing settings are outside cleanup scope.

If the workspace already has saved receptionist settings, the test refuses to overwrite them. If a sample configuration is edited concurrently, cleanup refuses to remove that changed configuration. Check the reported cleanup result before repeating a failed run.

## Run explicitly

Use Node 22 and the existing environment file. Refresh the test user's browser authentication, then opt in to live AI requests and temporary setup writes:

```sh
PLAYWRIGHT_BASE_URL=https://flowrish.marckengland.com npm run test:e2e:prod -- --project=setup
E2E_LIVE_AI=1 PLAYWRIGHT_BASE_URL=https://flowrish.marckengland.com node --env-file=.env --import tsx scripts/test-receptionist-live-ai.ts
```

The script is outside the automatic unit and browser suites. It never runs live AI calls from normal CI or regression commands. Existing AI-provider usage applies. No Twilio call is placed and no phone number is purchased.

## Acceptance checks

The real browser saves the sample business details and sends typed turns to the deployed preview endpoint without intercepting responses. Check the business greeting, an approved price, refusal to invent an unknown service or private draft price, removal of a revoked source on the next turn, corrected callback details, and explicit confirmation. A successful confirmation produces a preview summary only.

The run records synthetic prompts and replies, response times, and before/after CRM counts. It keeps screenshots and a JSON report under `/tmp`. Browser read-aloud does not prove real phone audio or speech recognition, and this test makes no real-phone claim.

## Safe setup and AI status

The harness requires the settings API's conditional-create capability header and sends `If-None-Match: *` on the real browser save. A database-atomic create returns HTTP 412 if settings already exist. The harness checks that a duplicate conditional save cannot overwrite its sample settings. Cleanup claims a configuration only after validating the disabled sample business and exact save response. Document cleanup also matches its last revision and timestamp, preserving concurrent edits.

The admin preview now identifies turns that used AI and reports coarse fallback reasons: rate limit, provider unavailable, timeout, invalid JSON, invalid response fields, or service unavailable. Raw provider errors, prompts, keys, and credentials are excluded. Confirmation remains deterministic and does not call AI again. These diagnostics are absent from the public phone response.

Two initial deployed-browser attempts answered the approved price but fell back on the next question. They were counted as failures, and both restored the baseline. Direct synthetic provider probes returned valid JSON and also observed an eight-second timeout. The new status makes a future fallback distinguishable from a successful AI answer; it does not claim that every provider error is eliminated.

## Local verification record

The compiled-app browser completed all seven sample turns with the live provider: PHP 750 pricing, unknown battery service, private draft exclusion, source revocation, callback capture, correction to Jordan Preview and +12025550124, and deterministic confirmation. Six turns invoked the real AI. Confirmation produced a preview-only summary, and cleanup restored 10 leads, 7 tasks, 9 activities, zero receptionist calls, zero configurations, zero voice configurations, and zero knowledge documents. Setup audit entries remain intentionally.

Regression checks passed: 1,220 unit tests, 41 disposable PostgreSQL tests, lint, both TypeScript engines, and production build. The browser suite passed 36 checks; five existing navigation guards skipped because their selectors found no eligible targets: contact row, company row, cadence row, task card, and New lead CTA. No existing assertions were changed or skipped for this release.

No telephone call, microphone input, or live phone-audio quality was tested. Run the same opt-in harness after deployment to verify the actual hosted provider path. Keep temporary fixture and report files private and never commit browser authentication or environment files.
