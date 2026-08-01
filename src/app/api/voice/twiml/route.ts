import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/voice/twiml
 *
 * TwiML webhook that Twilio hits when the browser `Device` starts an
 * outbound call. It returns instructions to bridge the browser client to
 * the dialed PSTN number, using the org's verified caller ID.
 *
 * Configure this URL as the Voice "Request URL" of your TwiML App
 * (Console → Voice → TwiML Apps). Twilio calls it directly, so it is NOT
 * behind the app's auth gate — see the middleware allow-list. It only ever
 * echoes the `To` parameter into a `<Dial>` verb; no data is read or
 * written.
 *
 * Hardening note: for production you should verify the `X-Twilio-Signature`
 * header against your auth token before trusting the request.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function POST(request: NextRequest) {
  const callerId = process.env.TWILIO_CALLER_ID ?? ''

  let to = ''
  try {
    const form = await request.formData()
    to = String(form.get('To') ?? '').trim()
  } catch {
    // Fall through with empty `to` → we return a spoken error below.
  }

  // Only allow E.164-ish numbers to reach <Dial> (defensive).
  const safeTo = /^[+]?[0-9()\-\s.]{4,20}$/.test(to)
    ? to.replace(/[^\d+]/g, '')
    : ''

  const twiml = safeTo
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${escapeXml(callerId)}"><Number>${escapeXml(safeTo)}</Number></Dial></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, no valid destination number was provided.</Say></Response>`

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
