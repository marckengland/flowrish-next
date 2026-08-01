import { NextRequest, NextResponse } from 'next/server'

import { getTwilioCallerId } from '@/server/services/voice'

/**
 * POST /api/voice/twiml
 *
 * TwiML webhook Twilio hits when a browser `Device` starts an outbound
 * call. It bridges the browser client to the dialed PSTN number using the
 * calling org's own verified caller ID.
 *
 * The browser dialer passes `To` and `OrgId` as custom call parameters;
 * Twilio forwards them here. `OrgId` is not sensitive — we only use it to
 * look up that org's caller ID. Configure this URL as the Voice "Request
 * URL" of each org's TwiML App. Twilio calls it directly, so it is NOT
 * behind the app's auth gate (see the middleware allow-list).
 *
 * Hardening note: for production, verify `X-Twilio-Signature` against the
 * org's auth token before trusting the request.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xml(body: string): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>${body}`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
}

export async function POST(request: NextRequest) {
  let to = ''
  let orgId = ''
  try {
    const form = await request.formData()
    to = String(form.get('To') ?? '').trim()
    orgId = String(form.get('OrgId') ?? '').trim()
  } catch {
    // fall through to error TwiML
  }

  const safeTo = /^[+]?[0-9()\-\s.]{4,20}$/.test(to)
    ? to.replace(/[^\d+]/g, '')
    : ''

  if (!safeTo) {
    return xml('<Response><Say>Sorry, no valid destination number was provided.</Say></Response>')
  }

  const callerId = orgId ? await getTwilioCallerId(orgId) : null
  if (!callerId) {
    return xml('<Response><Say>This workspace has not finished setting up calling.</Say></Response>')
  }

  return xml(
    `<Response><Dial callerId="${escapeXml(callerId)}"><Number>${escapeXml(safeTo)}</Number></Dial></Response>`,
  )
}
