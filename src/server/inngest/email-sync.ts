import { inngest } from './client'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { refreshTokenIfNeeded } from '@/server/services/email'
import { listMicrosoftMessagesPage } from '@/server/services/microsoft-email'
import { beginMailboxSync, completeMailboxSync, failMailboxSync, heartbeatMailboxSync } from '@/server/services/mailbox-sync'
import { decrypt } from '@/lib/encryption'
import { reconcileEmailReplies, type ReplyMessage } from '@/server/services/follow-ups'
import type { Prisma } from '@prisma/client'

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1'

/**
 * Event payload for email sync requests.
 */
export interface EmailSyncEventData {
  accountId: string
  organizationId: string
}

/**
 * Gmail message list response shape.
 */
interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

/**
 * Gmail message metadata response shape.
 */
interface GmailMessageMetadataResponse {
  id: string
  threadId: string
  internalDate: string
  payload: {
    headers: Array<{ name: string; value: string }>
  }
  snippet: string
}

/**
 * Extracts a header value from Gmail message headers (case-insensitive).
 */
function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  const header = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )
  return header?.value ?? ''
}

/**
 * Extracts the email address from a header value like "Name <email@example.com>"
 * or just "email@example.com".
 */
function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/)
  if (match) return match[1].toLowerCase()
  return headerValue.trim().toLowerCase()
}

/**
 * Durable Gmail/Microsoft mailbox sync, triggered manually or by the scheduler.
 * Each page persists messages and reconciles replies before its cursor commits.
 * The successful run-start timestamp advances only after every page finishes,
 * with a five-minute overlap so mail arriving during a run is read next time.
 * Provider failures retry without declaring a truncated scan successful.
 *
 * Validates: Requirements 7.6, 14.2
 */
export const emailSyncFunction = inngest.createFunction(
  {
    id: 'email-sync',
    retries: 3,
    concurrency: { limit: 1, key: 'event.data.accountId' },
    triggers: [{ event: 'email/sync.requested' }],
    onFailure: async ({ event }) => {
      const original = event.data.event
      if (!original.id) return
      await failMailboxSync(original.data.organizationId, original.data.accountId, original.id)
    },
  },
  async ({ event, step }) => {
    const { accountId, organizationId } = event.data as EmailSyncEventData
    const runId = event.id
    let startedAt: string
    try {
      startedAt = await step.run('begin-sync', async () => (await beginMailboxSync(organizationId, accountId, runId)).toISOString())
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SYNC_SUPERSEDED') return { skipped: true, reason: 'sync_superseded' }
      throw error
    }
    const db = createTenantPrisma(organizationId)
    const account = await step.run('refresh-token', async () => {
      await refreshTokenIfNeeded(accountId, organizationId)
      const found = await db.emailAccount.findFirst({
        where: { id: accountId },
        select: { id: true, email: true, accessToken: true, provider: true, userId: true, lastSyncAt: true },
      })
      if (!found) throw new Error(`EmailAccount ${accountId} not found`)
      return found
    })
    const checkpoint = account.lastSyncAt ? new Date(account.lastSyncAt).getTime() - 5 * 60_000 : new Date(startedAt).getTime() - 24 * 60 * 60_000
    const since = new Date(Math.min(checkpoint, new Date(startedAt).getTime()))
    let cursor: string | undefined
    let synced = 0
    let skipped = 0
    const seen = new Set<string>()
    for (let page = 0; page < 100; page++) {
      const currentCursor = cursor
      // Each page is a durable boundary. Only counts and a continuation cursor
      // leave the step; provider headers and mailbox content are not step output.
      const result = await step.run(`sync-page-${page}`, async () => {
        await heartbeatMailboxSync(organizationId, accountId, runId)
        const accessToken = decrypt(account.accessToken)
        let pageSynced = 0
        let pageSkipped = 0
        const replies: ReplyMessage[] = []
        const persist = async (externalId: string, load: () => Promise<ReplyMessage | null>) => {
          const saved = await db.$transaction(async (tx) => {
            const existing = await tx.emailMessage.findFirst({ where: { accountId, externalId } })
            if (existing) return { fresh: false, reply: existing.replyMetadata as unknown as ReplyMessage | null }
            const message = await load()
            if (!message) return { fresh: false, reply: null }
            const sentAt = new Date(message.sentAt)
            if (!Number.isFinite(sentAt.getTime())) throw new Error('Mailbox message has an invalid timestamp.')
            if ([message.fromEmail, message.toEmail].some((email) => email.toLowerCase() === account.email.toLowerCase())) {
              const legacy = await tx.emailMessage.findFirst({ where: { accountId: null, externalId, threadId: message.threadId, fromEmail: message.fromEmail, toEmail: message.toEmail, subject: message.subject } })
              if (legacy) {
                await tx.emailMessage.update({ where: { id: legacy.id }, data: { accountId, replyMetadata: message as unknown as Prisma.InputJsonValue } })
                return { fresh: false, reply: message }
              }
            }
            await tx.emailMessage.create({
              data: tenantData({
                accountId, externalId, threadId: message.threadId, fromEmail: message.fromEmail,
                toEmail: message.toEmail, subject: message.subject,
                bodyPreview: message.bodyPreview?.substring(0, 200) ?? null, sentAt,
                replyMetadata: message as unknown as Prisma.InputJsonValue,
              }),
            })
            return { fresh: true, reply: message }
          }, { timeout: 15000 })
          if (saved.fresh) pageSynced++
          else pageSkipped++
          if (saved.reply) replies.push(saved.reply)
        }

        let nextCursor: string | undefined
        if (account.provider === 'microsoft') {
          const messages = await listMicrosoftMessagesPage(accessToken, since.toISOString(), currentCursor)
          for (const message of messages.messages) await persist(message.externalId, async () => message)
          nextCursor = messages.nextLink
        } else {
          const params = new URLSearchParams({ maxResults: '50', q: `after:${Math.floor(since.getTime() / 1000)}` })
          if (currentCursor) params.set('pageToken', currentCursor)
          const response = await fetch(`${GMAIL_API_BASE}/users/me/messages?${params.toString()}`, {
            headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000), redirect: 'error',
          })
          if (!response.ok) throw new Error(`Gmail mailbox request failed (${response.status}). Reconnect the mailbox if this persists.`)
          const data = (await response.json()) as GmailMessageListResponse
          for (const item of data.messages ?? []) {
            await persist(item.id, async () => {
              const response = await fetch(`${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(item.id)}?format=metadata`, {
                headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000), redirect: 'error',
              })
              // A deleted message cannot be retrieved. Other failures must retry
              // before advancing the checkpoint, or the reply could be lost.
              if (response.status === 404) return null
              if (!response.ok) throw new Error(`Gmail mailbox request failed (${response.status}). Reconnect the mailbox if this persists.`)
              const message = (await response.json()) as GmailMessageMetadataResponse
              const headers = message.payload.headers
              return {
                externalId: message.id, threadId: message.threadId,
                fromEmail: extractEmailAddress(getHeader(headers, 'From')),
                toEmail: extractEmailAddress(getHeader(headers, 'To')),
                recipientEmails: getHeader(headers, 'To').split(',').map(extractEmailAddress),
                subject: getHeader(headers, 'Subject'), bodyPreview: message.snippet?.substring(0, 200) ?? null,
                sentAt: new Date(Number(message.internalDate)).toISOString(), headers,
              }
            })
          }
          nextCursor = data.nextPageToken
        }
        await reconcileEmailReplies(organizationId, accountId, replies, { userId: account.userId, email: account.email, provider: account.provider })
        await heartbeatMailboxSync(organizationId, accountId, runId)
        return { synced: pageSynced, skipped: pageSkipped, nextCursor }
      })
      synced += result.synced
      skipped += result.skipped
      if (!result.nextCursor) {
        await step.run('complete-sync', () => completeMailboxSync(organizationId, accountId, runId, new Date(startedAt)))
        return { synced, skipped }
      }
      if (seen.has(result.nextCursor)) throw new Error('Invalid mailbox continuation.')
      seen.add(result.nextCursor)
      cursor = result.nextCursor
    }
    throw new Error('Mailbox sync page limit reached. Contact support to resume this mailbox.')
  },
)
