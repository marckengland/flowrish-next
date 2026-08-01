import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { getTwilioCredentials } from '@/server/services/voice'
import { createTwilioVoiceToken } from '@/lib/twilio-token'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/voice/token
 *
 * Returns a short-lived Twilio Voice access token minted from the CURRENT
 * ORG'S own stored credentials (bring-your-own — nothing is shared across
 * tenants). When the org hasn't finished connecting Twilio, responds
 * `{ configured: false }` so the client falls back to free `tel:` calling.
 *
 * Auth: requires a valid session; the token identity is the user id and
 * `orgId` is echoed back so the dialer can tag the outbound call for the
 * TwiML webhook.
 */
export async function GET() {
  try {
    const session = await requireSession()

    const creds = await getTwilioCredentials(session.organizationId)
    if (!creds) {
      return NextResponse.json({ configured: false })
    }

    const token = createTwilioVoiceToken({
      accountSid: creds.accountSid,
      apiKeySid: creds.apiKeySid,
      apiKeySecret: creds.apiKeySecret,
      twimlAppSid: creds.twimlAppSid,
      identity: session.dbUser.id,
    })

    return NextResponse.json({
      configured: true,
      token,
      identity: session.dbUser.id,
      orgId: session.organizationId,
      callerId: creds.callerId,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
