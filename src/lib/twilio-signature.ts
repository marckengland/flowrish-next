import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Validates a Twilio request signature (`X-Twilio-Signature`).
 *
 * Twilio signs each webhook with the account's Auth Token: it concatenates
 * the full request URL with every POST parameter (sorted by key, as
 * `key + value`), HMAC-SHA1s that with the Auth Token, and base64-encodes
 * the result. We recompute it and compare in constant time.
 *
 * Docs: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false

  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('')

  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64')

  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
