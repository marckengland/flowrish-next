import { createHash } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { refreshTokenIfNeeded } from '@/server/services/email'
import { decrypt } from '@/lib/encryption'
import { AppError } from '@/lib/errors'

export interface EmailConversationMessage {
  id: string
  fromEmail: string
  toEmails: string[]
  sentAt: string
  subject: string
  text: string
  messageId?: string
  references?: string
}
export interface EmailConversation {
  accountId: string
  provider: 'gmail' | 'microsoft'
  threadId: string
  subject: string
  mailboxEmail: string
  recipientEmail: string
  messages: EmailConversationMessage[]
  fingerprint: string
}
export interface EmailConversationInput {
  accountId: string
  organizationId: string
  userId: string
  threadId: string
  sourceMessageId: string
  leadEmails: string[]
}
interface GmailPart {
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailPart[]
}
interface GmailMessage { id: string; threadId: string; internalDate: string; payload?: GmailPart }
interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  from?: { emailAddress?: { address?: string } }
  toRecipients?: Array<{ emailAddress?: { address?: string } }>
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>
  sentDateTime?: string
  receivedDateTime?: string
  body?: { contentType?: string; content?: string }
  internetMessageId?: string
  internetMessageHeaders?: Array<{ name: string; value: string }>
}
const maxMessages = 100
const maxCharacters = 100_000
const maxResponseBytes = 2_000_000
const tooLarge = () => new AppError('CONVERSATION_TOO_LARGE', 'The conversation is too large to draft safely. Review it manually in your mailbox.', 413)
const changed = () => new AppError('CONVERSATION_CHANGED', 'The conversation identity or participants changed. Refresh the follow-up and try again.', 409)
const incomplete = () => new AppError('CONVERSATION_INCOMPLETE', 'The complete email body could not be retrieved. Review this conversation in your mailbox.', 422)
function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find(value => value.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}
function addresses(value: string): string[] {
  return [...new Set((value.match(/[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/gi) ?? []).map(email => email.toLowerCase()))].sort()
}
function messageHeaders(headers: Array<{ name: string; value: string }> | undefined, id?: string) {
  const messageId = (id ?? header(headers, 'Message-ID')).trim()
  const references = header(headers, 'References').trim().replace(/\s+/g, ' ')
  const validId = /^<[^<>\s\r\n]+@[^<>\s\r\n]+>$/
  return {
    ...(validId.test(messageId) && messageId.length <= 998 ? { messageId } : {}),
    ...(references.length <= 4000 && references && references.split(/\s+/).every(value => validId.test(value)) ? { references } : {}),
  }
}
function plainHtml(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:br|hr)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? whole
      const numeric = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      return numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : '\uFFFD'
    }).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
function timestamp(value: string | number): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw incomplete()
  return parsed.toISOString()
}
export async function fetchEmailConversation(input: EmailConversationInput): Promise<EmailConversation> {
  const deadline = Date.now() + 25_000
  if (![input.accountId, input.organizationId, input.userId, input.threadId, input.sourceMessageId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 2048)) throw changed()
  const where = { id: input.accountId, organizationId: input.organizationId, userId: input.userId }
  const originalAccount = await prisma.emailAccount.findFirst({ where })
  if (!originalAccount) throw new AppError('NOT_FOUND', 'Mailbox is no longer available to this user.', 404)
  if (originalAccount.provider !== 'gmail' && originalAccount.provider !== 'microsoft') throw new AppError('VALIDATION_ERROR', 'This mailbox provider does not support conversation drafts.', 400)
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId: input.userId, organizationId: input.organizationId } } })
  if (!member) throw new AppError('FORBIDDEN', 'A current organization member is required.', 403)
  const permissions = await getEffectivePermissions(input.userId, input.organizationId)
  if (!permissions.has('leads:read') || !permissions.has('leads:write')) throw new AppError('FORBIDDEN', 'Lead read and write permission is required.', 403)
  const refreshRemaining = deadline - Date.now()
  if (refreshRemaining <= 0) throw new AppError('CONVERSATION_TIMEOUT', 'Conversation retrieval timed out. Try again.', 504)
  try {
    // The shared legacy refresher has no AbortSignal. Bound this request's wait;
    // a late credential refresh may finish, but no conversation request follows.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AppError('CONVERSATION_TIMEOUT', 'Conversation retrieval timed out. Try again.', 504)), Math.min(15_000, refreshRemaining))
      Promise.resolve().then(() => refreshTokenIfNeeded(input.accountId, input.organizationId)).then(() => { clearTimeout(timer); resolve() }, error => { clearTimeout(timer); reject(error) })
    })
  } catch (error) {
    if (error instanceof AppError && error.code === 'CONVERSATION_TIMEOUT') throw error
    throw new AppError('CONVERSATION_UNAVAILABLE', 'Reconnect your mailbox before retrieving this conversation.', 502)
  }
  const account = await prisma.emailAccount.findFirst({ where })
  if (!account || account.provider !== originalAccount.provider || account.email.toLowerCase() !== originalAccount.email.toLowerCase()) throw new AppError('NOT_FOUND', 'Mailbox changed or was disconnected. Refresh and try again.', 404)
  if (account.provider !== 'gmail' && account.provider !== 'microsoft') throw new AppError('VALIDATION_ERROR', 'This mailbox provider does not support conversation drafts.', 400)
  const mailboxEmail = account.email.trim().toLowerCase()
  const leadEmails = new Set(input.leadEmails.map(value => value.trim().toLowerCase()).filter(value => value !== mailboxEmail && addresses(value).length === 1 && addresses(value)[0] === value))
  if (!leadEmails.size) throw changed()
  let accessToken: string
  try { accessToken = decrypt(account.accessToken) } catch { throw new AppError('CONVERSATION_UNAVAILABLE', 'Reconnect your mailbox before retrieving this conversation.', 502) }
  const request = async <T>(url: string, extraHeaders: Record<string, string> = {}): Promise<T> => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new AppError('CONVERSATION_TIMEOUT', 'Conversation retrieval timed out. Try again or review it in your mailbox.', 504)
    let response: Response
    try { response = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken, ...extraHeaders }, signal: AbortSignal.timeout(Math.min(15_000, remaining)), redirect: 'error' }) }
    catch { throw new AppError('CONVERSATION_UNAVAILABLE', 'Unable to retrieve the complete conversation. Try again or reconnect your mailbox.', 502) }
    if (!response.ok) throw new AppError('CONVERSATION_UNAVAILABLE', 'Unable to retrieve the complete conversation. Reconnect your mailbox if this continues.', 502)
    if (Number(response.headers.get('content-length') ?? 0) > maxResponseBytes) throw tooLarge()
    let text: string
    if (response.body) {
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          bytes += part.value.length
          if (bytes > maxResponseBytes) { await reader.cancel(); throw tooLarge() }
          chunks.push(part.value)
        }
      } catch (error) {
        if (error instanceof AppError) throw error
        throw new AppError('CONVERSATION_UNAVAILABLE', 'Unable to retrieve the complete conversation. Try again.', 502)
      } finally { reader.releaseLock() }
      text = Buffer.concat(chunks).toString('utf8')
    } else {
      text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw tooLarge()
    }
    try { return JSON.parse(text) as T } catch { throw new AppError('CONVERSATION_UNAVAILABLE', 'Mailbox returned an unreadable conversation. Try again.', 502) }
  }
  const messages: EmailConversationMessage[] = []
  let characters = 0
  const addMessage = (message: EmailConversationMessage) => {
    if (!message.id || messages.some(existing => existing.id === message.id)) throw changed()
    characters += message.text.length + message.subject.length
    if (messages.length >= maxMessages || characters > maxCharacters) throw tooLarge()
    messages.push(message)
  }
  if (account.provider === 'gmail') {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me/'
    const conversation = await request<{ id?: string; messages?: GmailMessage[] }>(base + 'threads/' + encodeURIComponent(input.threadId) + '?format=full')
    if (conversation.id !== input.threadId || !Array.isArray(conversation.messages)) throw changed()
    if (conversation.messages.length > maxMessages) throw tooLarge()
    const readPart = async (part: GmailPart, messageId: string): Promise<{ text: string; plain: boolean } | null> => {
      if (part.filename || /^attachment\b/i.test(header(part.headers, 'Content-Disposition'))) return null
      if (part.parts?.length) {
        const pieces = []
        for (const child of part.parts) { const value = await readPart(child, messageId); if (value) pieces.push(value) }
        if (part.mimeType?.toLowerCase() === 'multipart/alternative') return pieces.find(value => value.plain) ?? pieces[0] ?? null
        return { text: pieces.map(value => value.text).filter(Boolean).join('\n'), plain: pieces.some(value => value.plain) }
      }
      const mimeType = part.mimeType?.toLowerCase()
      if (mimeType !== 'text/plain' && mimeType !== 'text/html') return null
      if (!part.body) throw incomplete()
      let data = part.body.data
      if (data === undefined && part.body.attachmentId) {
        data = (await request<{ data?: string }>(base + 'messages/' + encodeURIComponent(messageId) + '/attachments/' + encodeURIComponent(part.body.attachmentId))).data
        if (data === undefined) throw incomplete()
      }
      if (data === undefined && part.body.size !== 0) throw incomplete()
      if (data && (!/^[a-z0-9_-]*={0,2}$/i.test(data) || data.replace(/=+$/, '').length % 4 === 1)) throw incomplete()
      const charset = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(header(part.headers, 'Content-Type'))?.[1] ?? 'utf-8'
      let text: string
      try { text = new TextDecoder(charset, { fatal: true }).decode(Buffer.from(data ?? '', 'base64url')) } catch { throw incomplete() }
      return { text: mimeType === 'text/html' ? plainHtml(text) : text.replace(/\r\n?/g, '\n').trim(), plain: mimeType === 'text/plain' }
    }
    for (const message of conversation.messages) {
      if (message.threadId !== input.threadId || !message.payload) throw changed()
      const from = addresses(header(message.payload.headers, 'From'))
      if (from.length !== 1) throw changed()
      const body = await readPart(message.payload, message.id)
      addMessage({ id: message.id, fromEmail: from[0], toEmails: addresses(header(message.payload.headers, 'To') + ',' + header(message.payload.headers, 'Cc')), sentAt: timestamp(Number(message.internalDate)), subject: header(message.payload.headers, 'Subject'), text: body?.text ?? '', ...messageHeaders(message.payload.headers) })
    }
  } else {
    const params = new URLSearchParams({ '$top': '50', '$select': 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,internetMessageId,internetMessageHeaders', '$filter': "conversationId eq '" + input.threadId.replaceAll("'", "''") + "'" })
    let url: string | undefined = 'https://graph.microsoft.com/v1.0/me/messages?' + params.toString()
    const seen = new Set<string>()
    const continuation = (value: string) => {
      let next: URL
      try { next = new URL(value) } catch { throw new AppError('CONVERSATION_UNAVAILABLE', 'Invalid conversation continuation. Try again.', 502) }
      if (next.protocol !== 'https:' || next.hostname !== 'graph.microsoft.com' || next.port || next.username || next.password || next.hash || next.pathname !== '/v1.0/me/messages' || seen.has(next.toString())) throw new AppError('CONVERSATION_UNAVAILABLE', 'Invalid conversation continuation. Try again.', 502)
      seen.add(next.toString())
      return next.toString()
    }
    for (let page = 0; url && page < 20; page++) {
      const data: { value?: GraphMessage[]; '@odata.nextLink'?: string } = await request(url, { Prefer: 'outlook.body-content-type="text"' })
      if (!Array.isArray(data.value)) throw incomplete()
      for (const message of data.value) {
        if (message.conversationId !== input.threadId || !message.body || typeof message.body.content !== 'string') throw changed()
        const from = addresses(message.from?.emailAddress?.address ?? '')
        if (from.length !== 1) throw changed()
        addMessage({
          id: message.id, fromEmail: from[0], toEmails: addresses([...(message.toRecipients ?? []), ...(message.ccRecipients ?? [])].map(value => value.emailAddress?.address ?? '').join(',')),
          sentAt: timestamp(message.sentDateTime ?? message.receivedDateTime ?? ''), subject: message.subject ?? '',
          text: message.body.contentType?.toLowerCase() === 'html' ? plainHtml(message.body.content) : message.body.content.replace(/\r\n?/g, '\n').trim(),
          ...messageHeaders(message.internetMessageHeaders, message.internetMessageId),
        })
      }
      url = data['@odata.nextLink'] ? continuation(data['@odata.nextLink']) : undefined
    }
    if (url) throw tooLarge()
  }
  const source = messages.find(message => message.id === input.sourceMessageId)
  if (!source || !leadEmails.has(source.fromEmail) || !source.toEmails.includes(mailboxEmail)) throw changed()
  messages.sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt) || left.id.localeCompare(right.id))
  const subject = messages.at(-1)?.subject || source.subject
  const fingerprint = createHash('sha256').update(JSON.stringify({ accountId: account.id, provider: account.provider, threadId: input.threadId, recipientEmail: source.fromEmail, messages })).digest('hex')
  return { accountId: account.id, provider: account.provider, threadId: input.threadId, subject, mailboxEmail, recipientEmail: source.fromEmail, messages, fingerprint }
}
