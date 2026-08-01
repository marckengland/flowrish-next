import { NextRequest, NextResponse } from 'next/server'

import { getTwilioWebhookContext } from '@/server/services/voice'
import { validateTwilioSignature } from '@/lib/twilio-signature'

/**
 * POST /api/voice/twiml
 *
 * TwiML webhook Twilio hits when a browser `Device` starts an outbound
 * call. It bridges the browser client to the dialed PSTN number using the
 * calling org's own verified caller ID.
 *
 * The browser dialer passes `To` and `OrgId` as custom call parameters;
 * Twilio forwards them here. `OrgId` is not sensitive — we use it to look
 * up that org's caller ID and (when configured) its Auth Token to verify
 * the `X-Twilio-Signature`. Twilio calls this endpoint directly, so it is
 * NOT behind the app's auth gate (see the middleware allow-list).
 *
 * Security: when the org has stored an Auth Token, we reject any request
 * whose signature doesn't validate — this stops a stranger who guesses the
 * URL from placing billable calls on the org's Twilio account. Orgs that
 * haven't supplied an Auth Token get best-effort behavior (a warning is
 * logged) so calling still works during setup.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xml(body: string, status = 200): NextResponse {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

/** Reconstructs the public URL Twilio signed, honoring reverse-proxy headers. */
function requestUrl(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host
  return `${proto}://${host}${request.nextUrl.pathname}`
}

export async function POST(request: NextRequest) {
  // Read all POST params (needed both to dial and to verify the signature).
  const params: Record<string, string> = {}
  try {
    const form = await request.formData()
    for (const [key, value] of form.entries()) {
      params[key] = typeof value === 'string' ? value : ''
    }
  } catch {
    return xml('<Response><Say>Bad request.</Say></Response>', 400)
  }

  const to = (params.To ?? '').trim()
  const orgId = (params.OrgId ?? '').trim()

  const safeTo = /^[+]?[0-9()\-\s.]{4,20}$/.test(to) ? to.replace(/[^\d+]/g, '') : ''
  if (!safeTo) {
    return xml('<Response><Say>Sorry, no valid destination number was provided.</Say></Response>')
  }

  const { callerId, authToken } = orgId
    ? await getTwilioWebhookContext(orgId)
    : { callerId: null, authToken: null }

  if (!callerId) {
    return xml('<Response><Say>This workspace has not finished setting up calling.</Say></Response>')
  }

  // Verify Twilio's signature when the org supplied an Auth Token.
  if (authToken) {
    const valid = validateTwilioSignature(
      authToken,
      requestUrl(request),
      params,
      request.headers.get('x-twilio-signature'),
    )
    if (!valid) {
      return xml('<Response><Reject/></Response>', 403)
    }
  } else {
    console.warn(
      `[voice/twiml] org ${orgId} has no Twilio Auth Token set — webhook signature not verified.`,
    )
  }

  return xml(
    `<Response><Dial callerId="${escapeXml(callerId)}"><Number>${escapeXml(safeTo)}</Number></Dial></Response>`,
  )
}
