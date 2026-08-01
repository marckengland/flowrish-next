# Flowrish Integrations Guide — Calling, Email & Migration

This manual covers the bring-your-own integrations each organization sets up
inside Flowrish: **calling** (Twilio), **email** (Gmail + Microsoft 365 /
Outlook), and **data migration** from another CRM. It explains both how to set
them up and how they work under the hood.

> **Model:** Flowrish is multi-tenant. Telephony credentials are **per
> organization** — each org brings its own provider account, and secrets are
> **encrypted at rest** (AES-256-CBC, `EMAIL_ENCRYPTION_KEY`). The platform
> never ships shared calling keys. Email uses one platform-registered OAuth app
> per provider; each user connects their own mailbox.

---

## 1. Calling

Flowrish has two calling modes, chosen automatically per lead:

1. **Click-to-call (free, always on)** — the **Call** button on a lead uses a
   `tel:` link to launch the rep's device dialer / softphone. No provider, no
   per-minute cost. A live timer runs and the outcome + duration are logged as
   a **CALL activity** on the lead timeline.
2. **In-browser calling (Twilio)** — when the org selects **Twilio** and has
   entered credentials, the same **Call** button places the call inside the
   browser (with an in-app *End call* button). Falls back to `tel:` if Twilio
   isn't available.

### 1.1 Choosing a provider

Go to **Settings → Calling & voice**. You'll see a comparison of providers
(Twilio *Recommended*, plus Telnyx, SignalWire, Plivo, Bandwidth) with
indicative rates and pros/cons. Selecting one stores your org-wide preference.
Every card has a **How to connect** panel with deep links to each provider's
console. Today, **Twilio** is wired for in-browser calling end-to-end; the
others record your preference and show setup instructions.

### 1.2 Connecting Twilio (self-serve)

In **Settings → Calling & voice**, pick **Twilio**, then fill the *Connect your
Twilio account* form. Gather these from the [Twilio Console](https://console.twilio.com):

| Field | Where to get it |
|-------|-----------------|
| **Caller ID** | Buy a voice-enabled number → [Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/search). E.164 (e.g. `+14155551234`). |
| **Account SID** | Console dashboard (starts `AC…`). |
| **API Key SID** + **API Key Secret** | [API keys](https://console.twilio.com/us1/account/keys-credentials/api-keys) (secret shown once; `SK…`). |
| **TwiML App SID** | [TwiML Apps](https://console.twilio.com/us1/develop/voice/manage/twiml-apps) → create one. Set its **Voice Request URL** to the webhook URL shown in the form (`https://<your-domain>/api/voice/twiml`). SID starts `AP…`. |
| **Auth Token** *(recommended)* | Console dashboard. Enables webhook signature verification (see 1.4). |

Secrets (API Key Secret, Auth Token) are encrypted before storage and are
never returned to the browser — the form shows a masked "saved" placeholder.
Sensitive fields have a show/hide **eye** toggle.

### 1.3 How in-browser calling works

```
Browser (lead page)                 Flowrish server                 Twilio
   │  click "Call"                        │                            │
   │ ── GET /api/voice/token ───────────► │  mint short-lived JWT       │
   │                                      │  from the ORG's creds       │
   │ ◄── { token, orgId, callerId } ───── │                            │
   │  Device.connect({To, OrgId}) ───────────────────────────────────► │
   │                                      │ ◄── POST /api/voice/twiml ──│  (Twilio calls us)
   │                                      │  verify X-Twilio-Signature  │
   │                                      │  look up org caller ID      │
   │                                      │ ── <Dial callerId>…</Dial> ►│
   │ ◄════════════════ audio (WebRTC) ════════════════════════════════ │  bridged to the number
```

- The access token is minted server-side from the **org's own** Twilio
  credentials (`/api/voice/token`), never shared across tenants.
- The dialer tags each call with `OrgId`; the TwiML webhook uses it to look up
  that org's caller ID.
- On hang-up the rep logs the outcome + duration as a CALL activity.

### 1.4 Security — TwiML webhook signature

`/api/voice/twiml` must be publicly reachable (Twilio calls it directly), so it
can't sit behind login. To stop anyone who guesses the URL from placing billable
calls on your account, Flowrish verifies Twilio's `X-Twilio-Signature` using
your **Auth Token**. When an Auth Token is saved, unsigned/forged requests are
rejected (`403`). If you skip the Auth Token, calling still works but the webhook
is unverified (a warning is logged) — **we strongly recommend setting it.**

---

## 2. Email (Gmail & Microsoft 365 / Outlook)

Both providers write into the same **Activity / EmailMessage** tables, so
synced mail flows into the timeline, Rhythm/deal-health signals, conversation
intelligence, and dashboards regardless of provider. Sending is provider-aware:
the send pipeline resolves the user's connected mailbox (Gmail *or* Outlook) and
delivers accordingly. **Cadence email steps use the same pipeline, so they work
with either provider automatically.**

### 2.1 Gmail

Set the platform Google OAuth app env vars (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Users connect in
**Settings → Email → Gmail → Connect Gmail** (OAuth popup). Tokens are encrypted
at rest. Scopes: `gmail.send`, `gmail.readonly`.

### 2.2 Microsoft 365 / Outlook (Microsoft Graph)

**Operator setup (once per deployment):**

1. In the [Microsoft Entra admin center](https://entra.microsoft.com) →
   **App registrations → New registration**.
2. Add a **Web redirect URI**: `https://<your-domain>/api/email/microsoft/callback`.
3. **API permissions** → add delegated Microsoft Graph scopes and grant admin
   consent: `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`.
4. **Certificates & secrets** → create a client secret.
5. Set env vars and redeploy:
   - `MICROSOFT_CLIENT_ID` — Application (client) ID
   - `MICROSOFT_CLIENT_SECRET` — the client secret
   - `NEXT_PUBLIC_MICROSOFT_CLIENT_ID` — same client id (browser authorize URL)

Until these are set, the Outlook card in **Settings → Email** shows these exact
instructions instead of a connect button.

**Per-user:** once configured, each teammate clicks **Connect Outlook** and
authorizes their mailbox. Access + refresh tokens are encrypted at rest.

**How it works:**
- **Send** — via Graph: create a draft (`/me/messages`), attach files, then
  `/me/messages/{id}/send`. Replies thread into the existing conversation using
  `createReply` when a prior message exists (so cadence follow-ups nest in one
  Outlook conversation).
- **Sync** — the Inngest `email-sync` worker branches by provider; for Outlook
  it pulls recent messages via `GET /me/messages`, dedupes by message id, and
  links them to leads by email address, creating EMAIL activities.
- **Token refresh** — handled transparently before each send/sync.

---

## 3. Migrating from another CRM (Salesforce, HubSpot, Pipedrive, …)

**Import & Migrate** (sidebar → *Import / Export*) provides self-serve, no-ticket
migration built on the CSV importer, which auto-detects the standard column
names those tools export.

1. Pick your current CRM in the **Migrating from another CRM?** card for
   step-by-step export instructions (with a column-mapping cheat sheet).
2. Export your Leads/Contacts as CSV from that tool.
3. Upload it in the importer (Upload → Map columns → Preview → Result).

What happens on import: companies are auto-created from the Company/Account
column, a contact is linked when an email is present, and duplicate rows
(matching an existing email) are skipped — so re-running an import is safe.

---

## 4. Where credentials live (encryption summary)

| Credential | Storage | Encrypted |
|-----------|---------|-----------|
| Twilio API Key Secret, Auth Token | `VoiceConfig` (per org) | ✅ AES-256-CBC |
| Gmail access/refresh tokens | `EmailAccount` (per user) | ✅ AES-256-CBC |
| Microsoft access/refresh tokens | `EmailAccount` (per user) | ✅ AES-256-CBC |
| Selected voice provider | `Organization.voiceProvider` | n/a (not sensitive) |

All use the `EMAIL_ENCRYPTION_KEY` (32-byte hex). Rotating that key invalidates
stored secrets — reconnect after rotating.

---

## 5. Database migrations

These features add tables/columns. Apply migrations before use:

```bash
npx prisma migrate deploy   # production
# or during development:
npx prisma migrate dev
```

Relevant migrations: `add_voice_provider`, `add_voice_config`,
`add_twilio_auth_token`.
