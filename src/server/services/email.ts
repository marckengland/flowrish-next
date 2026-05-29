import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { encrypt, decrypt } from '@/lib/encryption'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import {
  replacePersonalizationTags as replaceTags,
  type PersonalizationLead,
} from '@/lib/personalization-tags'

const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'

/** 5-minute buffer in milliseconds for token refresh */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * Backward-compatible re-export of the lead shape used for
 * personalization. Some tests import this from the email service.
 */
type LeadForPersonalization = PersonalizationLead

interface GmailTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

interface GmailProfileResponse {
  emailAddress: string
}

interface GmailSendResponse {
  id: string
  threadId: string
}

/**
 * Exchanges a Google OAuth authorization code for tokens, encrypts them,
 * and creates an EmailAccount record for the user.
 *
 * Validates: Requirements 7.1
 */
export async function connectGmail(
  code: string,
  userId: string,
  orgId: string,
): Promise<{ email: string; accountId: string }> {
  // Exchange authorization code for tokens
  const tokenResponse = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/email/callback`,
    }),
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    throw new AppError(
      'GMAIL_AUTH_FAILED',
      `Failed to exchange OAuth code: ${errorText}`,
      400,
    )
  }

  const tokenData = (await tokenResponse.json()) as GmailTokenResponse

  if (!tokenData.refresh_token) {
    throw new AppError(
      'GMAIL_AUTH_FAILED',
      'No refresh token received. Please revoke access and try again with prompt=consent.',
      400,
    )
  }

  // Fetch the user's Gmail email address
  const profileResponse = await fetch(`${GMAIL_API_BASE}/users/me/profile`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!profileResponse.ok) {
    throw new AppError('GMAIL_AUTH_FAILED', 'Failed to fetch Gmail profile', 400)
  }

  const profile = (await profileResponse.json()) as GmailProfileResponse

  // Encrypt tokens before storage
  const encryptedAccessToken = encrypt(tokenData.access_token)
  const encryptedRefreshToken = encrypt(tokenData.refresh_token)
  const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000)

  // Create EmailAccount record
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  const db = createTenantPrisma(orgId)
  const account = await db.emailAccount.create({
    data: tenantData({
      userId,
      provider: 'gmail',
      email: profile.emailAddress,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiry,
    }),
  })

  return { email: profile.emailAddress, accountId: account.id }
}

/**
 * Checks if the token for an EmailAccount is about to expire (within 5-minute buffer)
 * and refreshes it if needed. Updates the stored encrypted tokens.
 *
 * Validates: Requirements 7.5
 */
export async function refreshTokenIfNeeded(
  accountId: string,
  orgId: string,
): Promise<void> {
  const db = createTenantPrisma(orgId)

  const account = await db.emailAccount.findFirst({
    where: { id: accountId },
  })

  if (!account) {
    throw new AppError('EMAIL_ACCOUNT_NOT_FOUND', 'Email account not found', 404)
  }

  const now = new Date()
  const expiryThreshold = new Date(account.tokenExpiry.getTime() - TOKEN_REFRESH_BUFFER_MS)

  // Token is still valid — no refresh needed
  if (now < expiryThreshold) {
    return
  }

  // Decrypt the refresh token
  const refreshToken = decrypt(account.refreshToken)

  // Call Google token refresh endpoint
  const response = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new AppError(
      'TOKEN_REFRESH_FAILED',
      'Failed to refresh Gmail token. Please re-authenticate.',
      401,
    )
  }

  const data = (await response.json()) as GmailTokenResponse

  // Encrypt new tokens and update the account
  const newAccessToken = encrypt(data.access_token)
  // Gmail may or may not return a new refresh token
  const newRefreshToken = data.refresh_token
    ? encrypt(data.refresh_token)
    : account.refreshToken
  const newExpiry = new Date(Date.now() + data.expires_in * 1000)

  await db.emailAccount.update({
    where: { id: accountId },
    data: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenExpiry: newExpiry,
    },
  })
}

/**
 * Replaces personalization tags in text with lead data.
 *
 * Delegates to {@link replaceTags} so the editor (which displays the
 * available tags) and the send pipeline (which substitutes them) read
 * from the same source of truth in `@/lib/personalization-tags`. Adding
 * a tag in one place will automatically work in the other.
 *
 * Validates: Requirements 7.2
 */
export function replacePersonalizationTags(
  text: string,
  lead: LeadForPersonalization,
): string {
  return replaceTags(text, lead)
}

/**
 * Wraps email body content in a proper HTML document with base styling
 * for consistent rendering across email clients.
 *
 * Validates: Requirements 7.3
 */
export function wrapHtmlEmail(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #333333;
    margin: 0;
    padding: 16px;
  }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
${body}
</body>
</html>`
}

/**
 * One file attachment delivered with an outgoing email. The send
 * service base64-encodes the bytes and emits a `multipart/mixed`
 * payload so Gmail attaches them to the message itself rather than
 * dropping them on the lead activity.
 */
export interface EmailAttachment {
  fileName: string
  mimeType: string
  /** Raw bytes of the attachment. */
  data: ArrayBuffer | Uint8Array
}

/**
 * Sends an email to a lead with personalization tag replacement,
 * HTML wrapping, optional file attachments, and Gmail API delivery.
 * Creates an EmailMessage record.
 *
 * Steps:
 * 1. Get the user's EmailAccount
 * 2. Refresh token if needed (tokenExpiry - 5 minutes < now)
 * 3. Replace personalization tags in subject and body
 * 4. Wrap body in HTML document with base styling
 * 5. Send via Gmail API (POST to gmail.googleapis.com/gmail/v1/users/me/messages/send),
 *    passing `threadId` for reply-in-thread when supplied (Requirement 7.3)
 *    and bundling any `attachments` as a `multipart/mixed` payload
 *    (Requirement 7.6 — attachments delivered with the message itself)
 * 6. Create EmailMessage record
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6
 */
export async function sendEmail(
  leadId: string,
  subject: string,
  body: string,
  userId: string,
  orgId: string,
  threadId?: string,
  attachments: readonly EmailAttachment[] = [],
): Promise<{ messageId: string; threadId: string; attachmentCount: number }> {
  const db = createTenantPrisma(orgId)

  // Get the lead for personalization data
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  if (!lead.email) {
    throw new AppError('LEAD_NO_EMAIL', 'Lead does not have an email address', 400)
  }

  // Get the user's connected email account
  const emailAccount = await db.emailAccount.findFirst({
    where: { userId, provider: 'gmail' },
  })

  if (!emailAccount) {
    throw new AppError(
      'NO_EMAIL_ACCOUNT',
      'No connected Gmail account. Please connect your Gmail account first.',
      400,
    )
  }

  // Refresh token if needed
  await refreshTokenIfNeeded(emailAccount.id, orgId)

  // Re-fetch account to get potentially updated access token
  const updatedAccount = await db.emailAccount.findFirst({
    where: { id: emailAccount.id },
  })

  if (!updatedAccount) {
    throw new AppError('EMAIL_ACCOUNT_NOT_FOUND', 'Email account not found after refresh', 500)
  }

  // Decrypt the access token
  const accessToken = decrypt(updatedAccount.accessToken)

  // Replace personalization tags in subject and body
  const personalizedSubject = replacePersonalizationTags(subject, lead)
  const personalizedBody = replacePersonalizationTags(body, lead)

  // Wrap body in HTML document with base styling
  const htmlBody = wrapHtmlEmail(personalizedBody)

  // For replies, look up the previous message on the thread so we can
  // emit the In-Reply-To / References headers Gmail uses to thread
  // conversations correctly. Falling back to no headers is fine — the
  // `threadId` on the JSON payload already carries the conversation.
  let inReplyToHeader: string | null = null
  if (threadId) {
    const lastMessageOnThread = await db.emailMessage.findFirst({
      where: { threadId },
      orderBy: { sentAt: 'desc' },
      select: { externalId: true },
    })
    if (lastMessageOnThread?.externalId) {
      // Gmail message IDs are not RFC 5322 Message-IDs but Gmail accepts
      // them for threading purposes.
      inReplyToHeader = `<${lastMessageOnThread.externalId}@mail.gmail.com>`
    }
  }

  // Build the raw email (RFC 2822 format, base64url encoded). When
  // attachments are present, switch to a `multipart/mixed` body so the
  // attachments travel with the message rather than as a separate
  // upload to the lead activity.
  const rawEmail =
    attachments.length > 0
      ? buildRawEmailWithAttachments(
          updatedAccount.email,
          lead.email,
          personalizedSubject,
          htmlBody,
          attachments,
          inReplyToHeader,
        )
      : buildRawEmail(
          updatedAccount.email,
          lead.email,
          personalizedSubject,
          htmlBody,
          inReplyToHeader,
        )

  // Send via Gmail API
  const sendResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: rawEmail,
      // Passing threadId tells Gmail to attach this message to the
      // existing conversation rather than start a new one.
      ...(threadId ? { threadId } : {}),
    }),
  })

  if (!sendResponse.ok) {
    const errorText = await sendResponse.text()
    throw new AppError('EMAIL_SEND_FAILED', `Failed to send email: ${errorText}`, 500)
  }

  const sendData = (await sendResponse.json()) as GmailSendResponse

  // Create EmailMessage record
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  await db.emailMessage.create({
    data: tenantData({
      externalId: sendData.id,
      threadId: sendData.threadId,
      fromEmail: updatedAccount.email,
      toEmail: lead.email,
      subject: personalizedSubject,
      bodyPreview: personalizedBody.substring(0, 200),
      sentAt: new Date(),
    }),
  })

  // Create an EMAIL activity on the lead so it appears in the timeline
  await db.activity.create({
    data: tenantData({
      type: 'EMAIL' as const,
      leadId,
      createdById: userId,
      notes: `Sent: ${personalizedSubject}`,
    }),
  })

  // Update lead's lastActivityAt
  await db.lead.update({
    where: { id: leadId },
    data: { lastActivityAt: new Date() },
  })

  return {
    messageId: sendData.id,
    threadId: sendData.threadId,
    attachmentCount: attachments.length,
  }
}

/**
 * Builds a raw RFC 2822 email message and encodes it as base64url
 * for the Gmail API send endpoint.
 *
 * `inReplyTo` (when supplied) sets the `In-Reply-To` and `References`
 * headers so the receiving client threads this message under the
 * referenced conversation (Requirement 7.3).
 */
function buildRawEmail(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  inReplyTo: string | null = null,
): string {
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    '',
    htmlBody,
  ]

  const message = messageParts.join('\r\n')

  // Base64url encode (Gmail API requirement)
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Builds a `multipart/mixed` raw email so attachments travel with the
 * message body. The structure is:
 *
 *   multipart/mixed (top-level)
 *     ├── text/html (the wrapped email body)
 *     └── application/octet-stream … (one part per attachment, base64-encoded)
 *
 * Boundary tokens are randomized per call to avoid collisions with the
 * body or attachment contents. The Gmail API requires the result
 * base64url-encoded, same as the plain-body path.
 */
function buildRawEmailWithAttachments(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  attachments: readonly EmailAttachment[],
  inReplyTo: string | null = null,
): string {
  const boundary = `flowrish_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
  ]

  const parts: string[] = []

  // 1. Body part — text/html with the same wrapper used by the plain-body path.
  parts.push(
    [
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      htmlBody,
    ].join('\r\n'),
  )

  // 2. One part per attachment. Body bytes are base64-encoded and split
  //    into 76-char lines per RFC 2045 so older clients don't choke.
  for (const att of attachments) {
    const bytes = att.data instanceof Uint8Array
      ? Buffer.from(att.data)
      : Buffer.from(att.data)
    const encoded = bytes.toString('base64').replace(/(.{76})/g, '$1\r\n')
    // Strip CR/LF and quotes from filename to avoid header injection;
    // a sufficiently weird filename is replaced with a generic one.
    const safeName = att.fileName
      .replace(/[\r\n"]+/g, ' ')
      .trim() || 'attachment'
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${safeName}"`,
        `Content-Disposition: attachment; filename="${safeName}"`,
        'Content-Transfer-Encoding: base64',
        '',
        encoded,
      ].join('\r\n'),
    )
  }

  const message = [
    headers.join('\r\n'),
    '',
    parts.join('\r\n'),
    `--${boundary}--`,
    '',
  ].join('\r\n')

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
