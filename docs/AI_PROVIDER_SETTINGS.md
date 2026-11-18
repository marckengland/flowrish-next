# Set an organization's AI provider

Open **Settings → AI provider** as an administrator of the current organization. Choose DeepSeek, Gemini, or OpenAI, enter a model identifier and API key, review the limits, then choose **Save AI settings**. Changes apply to the next request without a deployment. No API key is returned by the settings API or saved in browser storage.

The initial DeepSeek model is `deepseek-flash`. DeepSeek thinking is disabled for Flowrish's short business replies. Gemini initially uses `gemini-3.1-flash-lite`. For OpenAI, enter a model available to your account. Endpoints are fixed to these providers; arbitrary gateways and model discovery are outside this release.

Saving settings does not contact a provider. **Test connection** makes one small request using the saved configuration and counts against its allowance. Edit and save before testing changed values. Each connection test has an eight-second timeout. A successful test verifies credentials and a basic reply, not every model capability.

## Keys and organization boundaries

Keys are encrypted on the server with AES-256-GCM, bound to both organization and provider. The existing server encryption master remains in deployment secrets. Leave the key field blank to retain a saved key for the same provider. Changing providers requires a replacement key. The browser clears the input after save attempts, provider changes, and panel exit.

Only current organization members with `admin:settings` can read or change this panel. A stale form or connection-test version is rejected; reload before trying again. API responses identify only whether a key is saved, never its value or ciphertext.

Airish, AI email drafts, conversation follow-ups, account research, meeting summaries, and the receptionist use the current organization's configuration. Paused, invalid, exhausted, or unavailable organization settings fail visibly instead of using a shared key. Organizations with no configuration retain the deployment provider. The deployment AI key is optional when organizations supply their own keys.

## Usage and limits

The defaults are 20 requests per UTC day, 50,000 reserved tokens per UTC day, 2,048 output tokens per request, and 16,000 input bytes per request. UTC days reset at 08:00 in Asia/Manila. An administrator can change limits or pause organization AI.

Before contacting a provider, Flowrish atomically reserves one request and a conservative token allowance: serialized request bytes plus 256 overhead tokens plus the maximum response tokens. Requests exceeding the input or daily allowance are rejected before a provider call. Each feature also retains its own lower output allowance. Parallel requests cannot overrun the same daily reservation limit.

Reservations are not refunded after failures, timeouts, or cancellation, because the provider may already have processed the request. Provider-reported tokens are tracked separately. If reported usage exceeds a reservation, the reserved counter increases by the difference. These are application limits, not an exact provider invoice or a currency spending cap. Check the provider's billing dashboard for actual charges.

Closing an Airish response or aborting its HTTP request closes the upstream transport. Interrupted output without a provider completion marker is reported as an error. Partial knowledge replies retain the existing provenance marker so they cannot become future CRM action instructions.

Saving AI configuration does not connect Twilio or place a call. Automated verification uses synthetic keys and mocked provider transport. A live provider check requires a saved key and an explicit test.

[Airish](AIRISH.md) · [Integrations](INTEGRATIONS.md) · [Business knowledge](BUSINESS_KNOWLEDGE.md) · [Operations](ops/ORG_AI_PROVIDER_ROLLOUT.md) · [Documentation index](README.md)
