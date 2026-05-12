import { createTenantPrisma } from '@/server/db/middleware'
import { encrypt, decrypt } from '@/lib/encryption'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'

const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'

/** 5-minute buffer in milliseconds for token refresh */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

/**
 * Supported personalization tags and their corresponding Lead field accessors.
 */
const PERSONALIZATION_TAGS: Record<string, (lead: LeadForPersonalization) => string> = {
  '{{FirstName}}': (lead) => lead.firstName ?? '',
  '{{LastName}}': (lead) => lead.lastName ?? '',
  '{{FullName}}': (lead) => [lead.firstName, lead.lastName].filter(Boolean).join(' '),
  '{{CompanyName}}': (lead) => lead.companyName ?? '',
  '{{Title}}': (lead) => lead.title ?? '',
}

interface LeadForPersonalization {
  firstName: string
  lastName: string
  companyName: string | null
  title: string | null
}

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
  const db = createTenantPrisma(orgId)
  const account = await db.emailAccount.create({
    data: {
      userId,
      provider: 'gmail',
      email: profile.emailAddress,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiry,
    },
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
 * Tags: {{FirstName}}, {{LastName}}, {{FullName}}, {{CompanyName}}, {{Title}}
 *
 * Uses split/join instead of replaceAll to avoid special replacement patterns
 * ($&, $`, $', $<n>) being interpreted in lead field values.
 *
 * Validates: Requirements 7.2
 */
export function replacePersonalizationTags(
  text: string,
  lead: LeadForPersonalization,
): string {
  let result = text
  for (const [tag, accessor] of Object.entries(PERSONALIZATION_TAGS)) {
    result = result.split(tag).join(accessor(lead))
  }
  return result
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
 * Sends an email to a lead with personalization tag replacement,
 * HTML wrapping, and Gmail API delivery. Creates an EmailMessage record.
 *
 * Steps:
 * 1. Get the user's EmailAccount
 * 2. Refresh token if needed (tokenExpiry - 5 minutes < now)
 * 3. Replace personalization tags in subject and body
 * 4. Wrap body in HTML document with base styling
 * 5. Send via Gmail API (POST to gmail.googleapis.com/gmail/v1/users/me/messages/send)
 * 6. Create EmailMessage record
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5
 */
export async function sendEmail(
  leadId: string,
  subject: string,
  body: string,
  userId: string,
  orgId: string,
): Promise<{ messageId: string; threadId: string }> {
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

  // Build the raw email (RFC 2822 format, base64url encoded)
  const rawEmail = buildRawEmail(
    updatedAccount.email,
    lead.email,
    personalizedSubject,
    htmlBody,
  )

  // Send via Gmail API
  const sendResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawEmail }),
  })

  if (!sendResponse.ok) {
    const errorText = await sendResponse.text()
    throw new AppError('EMAIL_SEND_FAILED', `Failed to send email: ${errorText}`, 500)
  }

  const sendData = (await sendResponse.json()) as GmailSendResponse

  // Create EmailMessage record
  await db.emailMessage.create({
    data: {
      externalId: sendData.id,
      threadId: sendData.threadId,
      fromEmail: updatedAccount.email,
      toEmail: lead.email,
      subject: personalizedSubject,
      bodyPreview: personalizedBody.substring(0, 200),
      sentAt: new Date(),
    },
  })

  return { messageId: sendData.id, threadId: sendData.threadId }
}

/**
 * Builds a raw RFC 2822 email message and encodes it as base64url
 * for the Gmail API send endpoint.
 */
function buildRawEmail(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
): string {
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
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
