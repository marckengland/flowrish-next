import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { createTwilioVoiceToken } from '@/lib/twilio-token'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/voice/token
 *
 * Returns a short-lived Twilio Voice access token so the browser dialer
 * can register a `Device` and place outbound calls. When Twilio isn't
 * configured (env vars missing), responds `{ configured: false }` so the
 * client cleanly falls back to free `tel:` click-to-call.
 *
 * Auth: requires a valid session; the token identity is the user id.
 */
export async function GET() {
  try {
    const session = await requireSession()

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const apiKeySid = process.env.TWILIO_API_KEY
    const apiKeySecret = process.env.TWILIO_API_SECRET
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID
    const callerId = process.env.TWILIO_CALLER_ID

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid || !callerId) {
      return NextResponse.json({ configured: false })
    }

    const token = createTwilioVoiceToken({
      accountSid,
      apiKeySid,
      apiKeySecret,
      twimlAppSid,
      identity: session.dbUser.id,
    })

    return NextResponse.json({
      configured: true,
      token,
      identity: session.dbUser.id,
      callerId,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
