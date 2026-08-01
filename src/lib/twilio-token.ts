import { createHmac } from 'node:crypto'

/**
 * Mints a Twilio Voice Access Token (server-side only).
 *
 * A Twilio access token is a plain HS256 JWT with a Twilio-specific header
 * (`cty: twilio-fpa;v=1`) and a `grants.voice` claim. We build it directly
 * with `node:crypto` so we don't need to pull in the full `twilio` server
 * SDK just to sign a token.
 *
 * Docs: https://www.twilio.com/docs/iam/access-tokens
 */
export interface TwilioVoiceTokenParams {
  accountSid: string
  apiKeySid: string
  apiKeySecret: string
  /** The TwiML Application SID that handles outbound call routing. */
  twimlAppSid: string
  /** Stable identity for this client (we use the app user id). */
  identity: string
  /** Token lifetime in seconds. Defaults to 1 hour. */
  ttlSeconds?: number
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function createTwilioVoiceToken({
  accountSid,
  apiKeySid,
  apiKeySecret,
  twimlAppSid,
  identity,
  ttlSeconds = 3600,
}: TwilioVoiceTokenParams): string {
  const now = Math.floor(Date.now() / 1000)

  const header = {
    typ: 'JWT',
    alg: 'HS256',
    cty: 'twilio-fpa;v=1',
  }

  const payload = {
    jti: `${apiKeySid}-${now}`,
    iss: apiKeySid,
    sub: accountSid,
    nbf: now,
    exp: now + ttlSeconds,
    grants: {
      identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: twimlAppSid },
      },
    },
  }

  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = base64url(
    createHmac('sha256', apiKeySecret).update(signingInput).digest(),
  )

  return `${signingInput}.${signature}`
}
