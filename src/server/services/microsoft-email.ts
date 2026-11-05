import { encrypt } from '@/lib/encryption'
import { AppError } from '@/lib/errors'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'

/**
 * Microsoft 365 / Outlook email provider (Microsoft Graph).
 *
 * Mirrors the Gmail integration in `email.ts` but talks to Graph. One
 * Azure AD app is registered per deployment (MICROSOFT_CLIENT_ID/SECRET);
 * each user connects their own mailbox via OAuth. Access + refresh tokens
 * are encrypted at rest, identical to the Gmail path.
 */

const MS_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const MS_TOKEN_URL = `${MS_AUTHORITY}/token`
const MS_GRAPH = 'https://graph.microsoft.com/v1.0'

/** Delegated Graph scopes required to read + send mail with refresh. */
export const MICROSOFT_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
]

/** Token payload shape — intentionally matches Gmail's so callers share update logic. */
export interface MicrosoftTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

interface OutgoingAttachment {
  fileName: string
  mimeType: string
  data: ArrayBuffer | Uint8Array
}

/**
 * Normalized inbound message used by the sync worker. `sentAt` is an ISO
 * string (not a Date) so it survives Inngest step JSON serialization.
 */
export interface NormalizedMicrosoftMessage {
  recipientEmails?: string[]
  headers?: Array<{ name: string; value: string }>
  externalId: string
  threadId: string
  fromEmail: string
  toEmail: string
  subject: string
  bodyPreview: string | null
  sentAt: string
}

function requireMsConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new AppError(
      'MICROSOFT_NOT_CONFIGURED',
      'Microsoft email is not configured on this deployment.',
      400,
    )
  }
  return { clientId, clientSecret }
}

export function isMicrosoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET)
}

/**
 * Exchanges an OAuth authorization code for tokens, reads the mailbox
 * address from Graph, and stores an encrypted EmailAccount(provider=microsoft).
 * Reconnecting replaces any existing Microsoft account for the user.
 */
export async function connectMicrosoft(
  code: string,
  userId: string,
  orgId: string,
  redirectUri: string,
): Promise<{ email: string; accountId: string }> {
  const { clientId, clientSecret } = requireMsConfig()

  const tokenRes = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: MICROSOFT_SCOPES.join(' '),
    }),
  })

  if (!tokenRes.ok) {
    const text = await tokenRes.text()
    throw new AppError('MICROSOFT_AUTH_FAILED', `Failed to exchange OAuth code: ${text}`, 400)
  }

  const tokenData = (await tokenRes.json()) as MicrosoftTokenResponse
  if (!tokenData.refresh_token) {
    throw new AppError(
      'MICROSOFT_AUTH_FAILED',
      'No refresh token returned. Ensure the offline_access scope is granted and try again.',
      400,
    )
  }

  const meRes = await fetch(`${MS_GRAPH}/me`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  if (!meRes.ok) {
    throw new AppError('MICROSOFT_AUTH_FAILED', 'Failed to read Microsoft profile', 400)
  }
  const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string }
  const email = (me.mail ?? me.userPrincipalName ?? '').toLowerCase()
  if (!email) {
    throw new AppError('MICROSOFT_AUTH_FAILED', 'Could not determine the mailbox address', 400)
  }

  const db = createTenantPrisma(orgId)

  // Idempotent reconnect: drop any prior Microsoft account for this user.
  await db.emailAccount.deleteMany({ where: { userId, provider: 'microsoft' } })

  const account = await db.emailAccount.create({
    data: tenantData({
      userId,
      provider: 'microsoft',
      email,
      accessToken: encrypt(tokenData.access_token),
      refreshToken: encrypt(tokenData.refresh_token),
      tokenExpiry: new Date(Date.now() + tokenData.expires_in * 1000),
    }),
  })

  return { email, accountId: account.id }
}

/** Deletes the user's stored Microsoft mailbox connection. */
export async function disconnectMicrosoft(
  userId: string,
  orgId: string,
): Promise<{ disconnected: boolean }> {
  const db = createTenantPrisma(orgId)
  const result = await db.emailAccount.deleteMany({
    where: { userId, provider: 'microsoft' },
  })
  return { disconnected: result.count > 0 }
}

/** Refreshes an access token using the stored refresh token. */
export async function refreshMicrosoftToken(
  refreshToken: string,
): Promise<MicrosoftTokenResponse> {
  const { clientId, clientSecret } = requireMsConfig()
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: MICROSOFT_SCOPES.join(' '),
    }),
  })
  if (!res.ok) {
    throw new AppError(
      'TOKEN_REFRESH_FAILED',
      'Failed to refresh Microsoft token. Please reconnect Outlook.',
      401,
    )
  }
  return (await res.json()) as MicrosoftTokenResponse
}

/**
 * Sends an HTML email through Graph. Creates a draft (to capture the
 * message + conversation id for our records), attaches any files, then
 * sends it. Returns the message id + conversation id for threading.
 */
export async function deliverMicrosoftEmail(params: {
  accessToken: string
  to: string
  subject: string
  htmlBody: string
  attachments: readonly OutgoingAttachment[]
  /** When set, reply into this conversation so the message threads in Outlook. */
  replyToConversationId?: string
  /** Require an existing source conversation and bind the reviewed recipient. */
  strictReply?: boolean
  /** Revalidate manual/contextual delivery immediately before provider writes. */
  authorize?: () => Promise<void>
}): Promise<{ externalId: string; threadId: string }> {
  await params.authorize?.()
  const { accessToken, to, subject, htmlBody, attachments, replyToConversationId } = params
  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }

  // Threaded reply: locate the latest message in the conversation and
  // create a reply draft off it so Outlook nests the message. Falls back
  // to a fresh message if the conversation can't be found.
  let draft: { id: string; conversationId?: string } | null = null
  if (replyToConversationId) {
    draft = await createMicrosoftReplyDraft(
      accessToken,
      authHeaders,
      replyToConversationId,
      htmlBody,
      params.authorize,
    )
  }

  if (params.strictReply) {
    if (!draft || !replyToConversationId || draft.conversationId !== replyToConversationId) throw new AppError('DRAFT_CONFLICT', 'The source conversation is unavailable. Generate a new draft.', 409)
    await params.authorize?.()
    const bound = await fetch(`${MS_GRAPH}/me/messages/${encodeURIComponent(draft.id)}`, { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ subject, toRecipients: [{ emailAddress: { address: to } }] }) })
    if (!bound.ok) throw new AppError('EMAIL_SEND_FAILED', 'The reviewed reply could not be prepared.', 503)
  }

  if (!draft) {
    await params.authorize?.()
    const draftRes = await fetch(`${MS_GRAPH}/me/messages`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }],
      }),
    })
    if (!draftRes.ok) {
      if (params.authorize) throw new AppError('EMAIL_SEND_FAILED', 'The reviewed email could not be prepared. Check the mailbox and try again.', 503)
      const text = await draftRes.text()
      throw new AppError('EMAIL_SEND_FAILED', `Failed to create message: ${text}`, 500)
    }
    draft = (await draftRes.json()) as { id: string; conversationId?: string }
  }

  for (const att of attachments) {
    const bytes = Buffer.from(att.data as ArrayBuffer)
    await params.authorize?.()
    const attRes = await fetch(`${MS_GRAPH}/me/messages/${draft.id}/attachments`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.fileName || 'attachment',
        contentType: att.mimeType || 'application/octet-stream',
        contentBytes: bytes.toString('base64'),
      }),
    })
    if (!attRes.ok) {
      if (params.strictReply || params.authorize) throw new AppError('EMAIL_SEND_FAILED', 'A reviewed reply attachment could not be prepared.', 503)
      const text = await attRes.text()
      throw new AppError('EMAIL_SEND_FAILED', `Failed to attach file: ${text}`, 500)
    }
  }

  await params.authorize?.()
  const sendRes = await fetch(`${MS_GRAPH}/me/messages/${draft.id}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!sendRes.ok) {
    if (params.strictReply || params.authorize) throw new AppError('EMAIL_SEND_FAILED', 'The reviewed reply could not be sent. Check the connected mailbox and try again.', 503)
    const text = await sendRes.text()
    throw new AppError('EMAIL_SEND_FAILED', `Failed to send email: ${text}`, 500)
  }

  return { externalId: draft.id, threadId: draft.conversationId ?? draft.id }
}

/**
 * Creates a reply draft threaded into an existing conversation. Finds the
 * latest message in the conversation, calls Graph `createReply`, and sets
 * our HTML content on the resulting draft. Returns null (so the caller
 * falls back to a fresh message) if the conversation can't be located.
 */
async function createMicrosoftReplyDraft(
  accessToken: string,
  authHeaders: Record<string, string>,
  conversationId: string,
  htmlBody: string,
  authorize?: () => Promise<void>,
): Promise<{ id: string; conversationId?: string } | null> {
  try {
    const filter = `conversationId eq '${conversationId.replace(/'/g, "''")}'`
    const params = new URLSearchParams({
      $filter: filter,
      $top: '1',
      $orderby: 'receivedDateTime desc',
      $select: 'id,conversationId',
    })
    const listRes = await fetch(`${MS_GRAPH}/me/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!listRes.ok) return null
    const list = (await listRes.json()) as { value?: Array<{ id: string }> }
    const latestId = list.value?.[0]?.id
    if (!latestId) return null

    await authorize?.()
    const replyRes = await fetch(`${MS_GRAPH}/me/messages/${latestId}/createReply`, {
      method: 'POST',
      headers: authHeaders,
    })
    if (!replyRes.ok) return null
    const draft = (await replyRes.json()) as { id: string; conversationId?: string }

    // Replace the reply draft's body with our composed HTML.
    await authorize?.()
    const patchRes = await fetch(`${MS_GRAPH}/me/messages/${draft.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ body: { contentType: 'HTML', content: htmlBody } }),
    })
    if (!patchRes.ok) return null

    return draft
  } catch (error) {
    if (error instanceof AppError) throw error
    return null
  }
}

/**
 * Lists recent inbound/outbound messages for the mailbox (newest first),
 * normalized to the shape the sync worker persists.
 */
export async function listMicrosoftMessages(
  accessToken: string,
  sinceIso: string,
): Promise<NormalizedMicrosoftMessage[]> {
  const messages: NormalizedMicrosoftMessage[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  for (let page = 0; page < 100; page++) {
    const result = await listMicrosoftMessagesPage(accessToken, sinceIso, cursor)
    messages.push(...result.messages)
    if (!result.nextLink) return messages
    if (seen.has(result.nextLink)) throw new Error('Invalid Microsoft mailbox continuation')
    seen.add(result.nextLink)
    cursor = result.nextLink
  }
  throw new Error('Mailbox sync page limit reached. Contact support to resume this mailbox.')
}

export async function listMicrosoftMessagesPage(
  accessToken: string,
  sinceIso: string,
  cursor?: string,
): Promise<{ messages: NormalizedMicrosoftMessage[]; nextLink?: string }> {
  const params = new URLSearchParams({
    $top: '50',
    $select: 'id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,internetMessageHeaders',
    $orderby: 'receivedDateTime desc',
    $filter: `receivedDateTime ge ${sinceIso}`,
  })
  const initial = `${MS_GRAPH}/me/messages?${params.toString()}`
  const validate = (value: string) => {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('Invalid Microsoft mailbox continuation') }
    if (url.protocol !== 'https:' || url.hostname !== 'graph.microsoft.com'
      || url.port || url.username || url.password || url.hash
      || url.pathname !== '/v1.0/me/messages') throw new Error('Invalid Microsoft mailbox continuation')
    return url.toString()
  }
  const res = await fetch(cursor ? validate(cursor) : initial, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`Microsoft mailbox request failed (${res.status}). Reconnect the mailbox if this persists.`)
  const data = (await res.json()) as {
    '@odata.nextLink'?: string
    value?: Array<{
      id: string
      conversationId?: string
      internetMessageHeaders?: Array<{ name: string; value: string }>
      subject?: string
      bodyPreview?: string
      receivedDateTime?: string
      from?: { emailAddress?: { address?: string } }
      toRecipients?: Array<{ emailAddress?: { address?: string } }>
    }>
  }
  const nextLink = data['@odata.nextLink'] ? validate(data['@odata.nextLink']) : undefined
  return {
    nextLink,
    messages: (data.value ?? []).map((m) => ({
      externalId: m.id,
      headers: m.internetMessageHeaders ?? [],
      recipientEmails: (m.toRecipients ?? []).map((r) => (r.emailAddress?.address ?? '').toLowerCase()),
      threadId: m.conversationId ?? m.id,
      fromEmail: (m.from?.emailAddress?.address ?? '').toLowerCase(),
      toEmail: (m.toRecipients?.[0]?.emailAddress?.address ?? '').toLowerCase(),
      subject: m.subject ?? '',
      bodyPreview: m.bodyPreview ?? null,
      sentAt: m.receivedDateTime ?? new Date().toISOString(),
    })),
  }
}
