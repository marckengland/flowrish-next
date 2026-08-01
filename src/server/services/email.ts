import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { encrypt, decrypt } from '@/lib/encryption'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import {
  replacePersonalizationTags as replaceTags,
  type PersonalizationLead,
} from '@/lib/personalization-tags'
import {
  deliverMicrosoftEmail,
  refreshMicrosoftToken,
} from '@/server/services/microsoft-email'

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
  redirectUri: string,
): Promise<{ email: string; accountId: string }> {
  // Exchange authorization code for tokens. The `redirect_uri` here MUST
  // be byte-for-byte identical to the one the browser sent in the
  // initial /o/oauth2/v2/auth request, otherwise Google rejects with
  // `redirect_uri_mismatch`. Callers pass it explicitly so the value
  // travels with the code rather than being reconstructed from a
  // separate (and easy to drift) env var.
  const tokenResponse = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
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
 * Disconnects the user's Gmail account.
 *
 * - Revokes the refresh token at Google so any stored copy becomes
 *   immediately useless if it ever leaks. Best-effort: if Google's
 *   revoke endpoint is unreachable or returns an error (e.g. the token
 *   was already revoked from the user's Google account page), we still
 *   delete the local row so the app stops using it.
 * - Deletes the EmailAccount row. Existing EmailMessage / Activity
 *   records are kept — they're history, not credentials.
 *
 * Validates: Requirements 7.1
 */
export async function disconnectGmail(
  userId: string,
  orgId: string,
): Promise<{ disconnected: boolean }> {
  const db = createTenantPrisma(orgId)

  const account = await db.emailAccount.findFirst({
    where: { userId, provider: 'gmail' },
  })

  if (!account) {
    // Nothing to do — already disconnected.
    return { disconnected: false }
  }

  // Best-effort token revocation. Wrapped in a try so a transient
  // Google outage doesn't strand the user with a "connected" UI they
  // can't get rid of.
  try {
    const refreshToken = decrypt(account.refreshToken)
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    })
  } catch {
    // Swallow — the local delete below is the source of truth for the
    // app. Users can also revoke from Google's side at
    // https://myaccount.google.com/permissions.
  }

  await db.emailAccount.delete({ where: { id: account.id } })

  return { disconnected: true }
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

  // Refresh via the account's provider. Both providers return the same
  // { access_token, refresh_token?, expires_in } shape so the update
  // logic below is shared.
  let data: GmailTokenResponse
  if (account.provider === 'microsoft') {
    data = await refreshMicrosoftToken(refreshToken)
  } else {
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

    data = (await response.json()) as GmailTokenResponse
  }

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
 * Wraps email body content in a proper HTML document with base
 * styling for consistent rendering across email clients.
 *
 * Email-client realities the wrapper accounts for:
 *
 *  1. **Outlook strips `<style>`** in many configurations, so we apply
 *     the base typography directly to the `<body>` element via
 *     `style="…"` rather than relying on the `<head>` block alone.
 *  2. **Tailwind classes don't ship to the recipient** — the rich
 *     editor outputs `class="text-blue-600 underline"` on links. We
 *     post-process those into inline `style` attributes so links
 *     stay blue/underlined even when no stylesheet is loaded.
 *  3. **Outputs from the editor (TipTap) use semantic tags** —
 *     `<strong>`, `<em>`, `<u>`, `<s>`, `<ul>`, `<ol>`, plus inline
 *     `<span style="…">` for color, font-family, and font-size. These
 *     are all preserved unchanged so the recipient sees identical
 *     formatting to what the sender authored.
 *
 * Validates: Requirements 7.3
 */
export function wrapHtmlEmail(body: string): string {
  // The TipTap link extension applies a Tailwind class to anchors. We
  // replicate the same look as inline style so the styling survives in
  // mail clients that drop the `<style>` block.
  const inlinedBody = body
    .replace(
      /<a\b([^>]*?)class="text-blue-600 underline"([^>]*)>/gi,
      (_match, before, after) => {
        // If the anchor already has a `style` attribute, don't double-apply.
        const merged = `${before}${after}`
        if (/style=/i.test(merged)) return `<a${merged}>`
        return `<a${before}${after} style="color:#2563eb;text-decoration:underline;">`
      },
    )

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
  ul, ol { padding-left: 24px; margin: 0 0 12px; }
  p { margin: 0 0 12px; }
  blockquote { border-left: 3px solid #d1d5db; margin: 0 0 12px; padding: 0 12px; color: #4b5563; }
</style>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.6;color:#333333;margin:0;padding:16px;">
${inlinedBody}
</body>
</html>`
}

/**
 * Cheap HTML→plain-text fallback used as the `text/plain` part of the
 * `multipart/alternative` payload. Email clients that don't render
 * HTML (or strip it for security) will show this version, so we want
 * the same words and structure even if the formatting is gone.
 *
 * The transformation:
 *   1. Drops `<style>` and `<script>` blocks entirely.
 *   2. Translates block-level boundaries to newlines so paragraphs and
 *      list items don't all run together.
 *   3. Surfaces link targets as "text (url)" so recipients can still
 *      see and click them.
 *   4. Decodes the most common HTML entities.
 *   5. Collapses runs of blank lines.
 */
export function htmlToPlainText(html: string): string {
  // Strip script/style content entirely
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')

  // Surface link targets so recipients without HTML can still click.
  text = text.replace(
    /<a\b[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => {
      const innerText = String(inner).replace(/<[^>]+>/g, '').trim()
      if (!innerText) return href as string
      if (innerText === href) return innerText
      return `${innerText} (${href})`
    },
  )

  // Bullet list items
  text = text.replace(/<li\b[^>]*>/gi, '\n• ')
  text = text.replace(/<\/li>/gi, '')

  // Block-level boundaries → newlines
  text = text.replace(/<\/(p|div|h[1-6]|tr|li|ul|ol)>/gi, '\n')
  text = text.replace(/<br\s*\/?\s*>/gi, '\n')

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode the entities the editor is likely to emit
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))

  // Collapse trailing whitespace per line, then collapse runs of blank lines.
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text
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

  // Get the user's connected email account (Gmail or Microsoft). When a
  // user has more than one, the most recently connected wins.
  const emailAccount = await db.emailAccount.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })

  if (!emailAccount) {
    throw new AppError(
      'NO_EMAIL_ACCOUNT',
      'No connected email account. Please connect Gmail or Outlook first.',
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

  // Deliver via the account's provider, capturing an external message id
  // and a thread/conversation id for our EmailMessage record.
  let externalId: string
  let resultThreadId: string

  if (updatedAccount.provider === 'microsoft') {
    const delivered = await deliverMicrosoftEmail({
      accessToken,
      to: lead.email,
      subject: personalizedSubject,
      htmlBody,
      attachments,
    })
    externalId = delivered.externalId
    resultThreadId = delivered.threadId
  } else {
    // Gmail: emit In-Reply-To / References headers so replies thread.
    let inReplyToHeader: string | null = null
    if (threadId) {
      const lastMessageOnThread = await db.emailMessage.findFirst({
        where: { threadId },
        orderBy: { sentAt: 'desc' },
        select: { externalId: true },
      })
      if (lastMessageOnThread?.externalId) {
        inReplyToHeader = `<${lastMessageOnThread.externalId}@mail.gmail.com>`
      }
    }

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

    const sendResponse = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: rawEmail,
        ...(threadId ? { threadId } : {}),
      }),
    })

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text()
      throw new AppError('EMAIL_SEND_FAILED', `Failed to send email: ${errorText}`, 500)
    }

    const sendData = (await sendResponse.json()) as GmailSendResponse
    externalId = sendData.id
    resultThreadId = sendData.threadId
  }

  // Create EmailMessage record
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  await db.emailMessage.create({
    data: tenantData({
      externalId,
      threadId: resultThreadId,
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
    messageId: externalId,
    threadId: resultThreadId,
    attachmentCount: attachments.length,
  }
}

/**
 * Sample lead used to substitute personalization tags in test emails.
 * Mirrors the sample values surfaced in the rich text editor preview.
 */
const TEST_PERSONALIZATION_LEAD: PersonalizationLead = {
  firstName: 'John',
  lastName: 'Smith',
  companyName: 'Acme Corp',
  title: 'VP of Sales',
}

/**
 * Sends a one-off test email to the user's own connected Gmail
 * inbox. Used by the cadence step editor and the per-lead composer
 * so reps can preview the rendered email — including formatting,
 * personalization-tag substitution, and the wrapping HTML — before
 * activating a cadence or hitting send for real.
 *
 * Differences from {@link sendEmail}:
 *   - Recipient is the connected Gmail account (the sender), not a lead.
 *   - Personalization tags are substituted with sample values so
 *     `{{FirstName}}` etc. render the same way the editor preview shows.
 *   - The subject is prefixed with `[Test]` so the user can tell test
 *     sends apart from real outbound mail in their inbox.
 *   - No EmailMessage / Activity rows are created — tests don't appear
 *     in the lead timeline.
 */
export async function sendTestEmail(
  subject: string,
  body: string,
  userId: string,
  orgId: string,
  attachments: readonly EmailAttachment[] = [],
): Promise<{ messageId: string; recipient: string }> {
  const db = createTenantPrisma(orgId)

  const emailAccount = await db.emailAccount.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })

  if (!emailAccount) {
    throw new AppError(
      'NO_EMAIL_ACCOUNT',
      'No connected email account. Please connect Gmail or Outlook first.',
      400,
    )
  }

  await refreshTokenIfNeeded(emailAccount.id, orgId)

  const updatedAccount = await db.emailAccount.findFirst({
    where: { id: emailAccount.id },
  })

  if (!updatedAccount) {
    throw new AppError(
      'EMAIL_ACCOUNT_NOT_FOUND',
      'Email account not found after refresh',
      500,
    )
  }

  const accessToken = decrypt(updatedAccount.accessToken)

  // Substitute tags with the same sample values the editor preview
  // shows so the test email matches what the user already saw.
  const renderedSubject = `[Test] ${replacePersonalizationTags(
    subject,
    TEST_PERSONALIZATION_LEAD,
  )}`
  const renderedBody = replacePersonalizationTags(
    body,
    TEST_PERSONALIZATION_LEAD,
  )
  const htmlBody = wrapHtmlEmail(renderedBody)

  // Send to self — the connected mailbox address.
  const recipient = updatedAccount.email

  let messageId: string
  if (updatedAccount.provider === 'microsoft') {
    const delivered = await deliverMicrosoftEmail({
      accessToken,
      to: recipient,
      subject: renderedSubject,
      htmlBody,
      attachments,
    })
    messageId = delivered.externalId
  } else {
    const rawEmail =
      attachments.length > 0
        ? buildRawEmailWithAttachments(
            recipient,
            recipient,
            renderedSubject,
            htmlBody,
            attachments,
            null,
          )
        : buildRawEmail(recipient, recipient, renderedSubject, htmlBody, null)

    const sendResponse = await fetch(
      `${GMAIL_API_BASE}/users/me/messages/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: rawEmail }),
      },
    )

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text()
      throw new AppError(
        'EMAIL_SEND_FAILED',
        `Failed to send test email: ${errorText}`,
        500,
      )
    }

    const sendData = (await sendResponse.json()) as GmailSendResponse
    messageId = sendData.id
  }

  // Intentionally skip EmailMessage / Activity creation — test sends
  // shouldn't pollute the lead timeline or the inbox sync state.
  return { messageId, recipient }
}

/**
 * Builds a raw RFC 2822 email message and encodes it as base64url
 * for the Gmail API send endpoint.
 *
 * The body is delivered as `multipart/alternative` with a `text/plain`
 * fallback derived from the HTML — recipients on text-only clients
 * (or accessibility tools that strip HTML for security) still see the
 * same content, just without the formatting layer.
 *
 * Both parts are emitted with `quoted-printable` Content-Transfer-Encoding
 * so non-ASCII characters (em dashes, smart quotes, accented names from
 * personalization tags) survive transit unchanged.
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
  const altBoundary = makeBoundary('alt')
  const plainBody = htmlToPlainText(htmlBody)

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
  ]

  const message = [
    headers.join('\r\n'),
    '',
    buildMultipartAlternative(altBoundary, plainBody, htmlBody),
  ].join('\r\n')

  return base64UrlEncode(message)
}

/**
 * Builds a `multipart/mixed` raw email so attachments travel with the
 * message body. The structure is:
 *
 *   multipart/mixed (top-level)
 *     ├── multipart/alternative
 *     │     ├── text/plain (cheap fallback)
 *     │     └── text/html  (the wrapped editor output)
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
  const mixedBoundary = makeBoundary('mixed')
  const altBoundary = makeBoundary('alt')
  const plainBody = htmlToPlainText(htmlBody)

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
  ]

  const parts: string[] = []

  // 1. Body wrapper — multipart/alternative with text/plain + text/html
  parts.push(
    [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      buildMultipartAlternative(altBoundary, plainBody, htmlBody),
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
        `--${mixedBoundary}`,
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
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n')

  return base64UrlEncode(message)
}

// ─── MIME helpers ────────────────────────────────────────────────────────────

/**
 * Constructs the inner `multipart/alternative` payload shared between
 * the plain-body and attachment-bearing send paths. Both subparts use
 * `quoted-printable` encoding so non-ASCII characters survive intact.
 */
function buildMultipartAlternative(
  boundary: string,
  plainBody: string,
  htmlBody: string,
): string {
  return [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encodeQuotedPrintable(plainBody),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encodeQuotedPrintable(htmlBody),
    `--${boundary}--`,
  ].join('\r\n')
}

function makeBoundary(tag: string): string {
  return `flowrish_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function base64UrlEncode(message: string): string {
  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Encodes an RFC 2047 "encoded-word" form for the Subject header so
 * non-ASCII characters (smart quotes, em dashes, accented names from
 * personalization tags) survive without mojibake. ASCII subjects pass
 * through untouched.
 */
function encodeMimeHeaderValue(value: string): string {
  if (!/[^\x00-\x7F]/.test(value)) return value
  const encoded = Buffer.from(value, 'utf8').toString('base64')
  return `=?UTF-8?B?${encoded}?=`
}

/**
 * RFC 2045 quoted-printable encoder. The output is safe to embed
 * inside a MIME body part with `Content-Transfer-Encoding:
 * quoted-printable`.
 *
 *  - Non-ASCII bytes and control characters are encoded as `=XX`.
 *  - The literal `=` is encoded as `=3D`.
 *  - Trailing whitespace on a line is encoded so it survives MTA
 *    line-folding (otherwise some hops trim the final spaces).
 *  - Lines are soft-wrapped at 76 chars with `=` continuation per the
 *    RFC, and `\n` is normalized to `\r\n` for Gmail's RFC 5322 wire
 *    expectations.
 */
function encodeQuotedPrintable(input: string): string {
  const bytes = Buffer.from(input, 'utf8')
  // Pass 1: encode each byte that needs encoding.
  let encoded = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    // Tab (9) and printable ASCII except `=` (61)
    if (b === 9 || (b >= 32 && b <= 126 && b !== 61)) {
      encoded += String.fromCharCode(b)
    } else if (b === 13 && bytes[i + 1] === 10) {
      // Preserve CRLF line breaks.
      encoded += '\r\n'
      i++
    } else if (b === 10) {
      encoded += '\r\n'
    } else {
      encoded += `=${b.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }

  // Pass 2: protect trailing whitespace so MTAs don't strip it, and
  // soft-wrap to 76 columns. We split on the existing CRLFs so the
  // wrapping logic doesn't merge separate lines.
  const lines = encoded.split('\r\n').map((line) => {
    // Encode trailing whitespace on the line.
    if (line.length) {
      const trail = line.match(/[ \t]+$/)
      if (trail) {
        const head = line.slice(0, -trail[0].length)
        const encodedTrail = trail[0]
          .split('')
          .map((c) =>
            c === ' '
              ? '=20'
              : '=09',
          )
          .join('')
        line = head + encodedTrail
      }
    }
    // Soft-wrap to 76 chars (75 + `=` continuation).
    const wrapped: string[] = []
    let i = 0
    while (line.length - i > 75) {
      // Don't split inside a `=XX` triplet — back off if needed.
      let breakAt = i + 75
      if (line[breakAt - 1] === '=') breakAt -= 1
      else if (line[breakAt - 2] === '=') breakAt -= 2
      wrapped.push(`${line.slice(i, breakAt)}=`)
      i = breakAt
    }
    wrapped.push(line.slice(i))
    return wrapped.join('\r\n')
  })

  return lines.join('\r\n')
}


/**
 * Test-only re-export of the private MIME helpers. Lets the unit
 * tests assert the on-the-wire shape (multipart parts, encodings,
 * inlined link styles) without forcing us to make the helpers part of
 * the public service API.
 */
export const __testing__ = {
  buildRawEmail,
  buildRawEmailWithAttachments,
  encodeQuotedPrintable,
  encodeMimeHeaderValue,
  base64UrlEncode,
}
