import { inngest } from './client'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { refreshTokenIfNeeded } from '@/server/services/email'
import { listMicrosoftMessages } from '@/server/services/microsoft-email'
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
 * Inngest durable function for on-demand email sync from Gmail.
 *
 * Triggered by the `email/sync.requested` event. Fetches recent emails
 * from the connected Gmail account, creates EmailMessage records for new
 * messages (skipping duplicates by externalId), and links messages to
 * leads by matching email addresses.
 *
 * Steps:
 * 1. Refresh OAuth token if needed
 * 2. Fetch recent message IDs from Gmail (messages.list)
 * 3. For each message, fetch metadata and create EmailMessage record
 * 4. Update lastSyncAt on the EmailAccount
 *
 * Validates: Requirements 7.6, 14.2
 */
export const emailSyncFunction = inngest.createFunction(
  {
    id: 'email-sync',
    retries: 3,
    triggers: [{ event: 'email/sync.requested' }],
  },
  async ({ event, step }) => {
    const { accountId, organizationId } = event.data as EmailSyncEventData
    const db = createTenantPrisma(organizationId)
    const account = await step.run('refresh-token', async () => {
      await refreshTokenIfNeeded(accountId, organizationId)
      const found = await db.emailAccount.findFirst({
        where: { id: accountId },
        select: { id: true, email: true, accessToken: true, provider: true, userId: true },
      })
      if (!found) throw new Error(`EmailAccount ${accountId} not found`)
      return found
    })

    // This step's output includes the persisted reply metadata. Inngest can
    // replay reconciliation if it fails after message persistence committed.
    const result = await step.run('process-messages', async () => {
      const accessToken = decrypt(account.accessToken)
      let synced = 0
      let skipped = 0
      const replies: ReplyMessage[] = []

      const persist = async (externalId: string, load: () => Promise<ReplyMessage | null>) => {
        const saved = await db.$transaction(async (tx) => {
          const existing = await tx.emailMessage.findFirst({ where: { accountId, externalId } })
          if (existing) {
            return { fresh: false, reply: existing.replyMetadata as unknown as ReplyMessage | null }
          }
          const message = await load()
          if (!message) return { fresh: false, reply: null }
          const sentAt = new Date(message.sentAt)
          if (!Number.isFinite(sentAt.getTime())) return { fresh: false, reply: null }
          // Preserve pre-mailbox-identity history when the provider ID,
          // thread and both endpoints match this mailbox exactly. Adoption
          // replays reply detection without creating another activity.
          if ([message.fromEmail, message.toEmail].some((email) => email.toLowerCase() === account.email.toLowerCase())) {
            const legacy = await tx.emailMessage.findFirst({ where: { accountId: null, externalId, threadId: message.threadId, fromEmail: message.fromEmail, toEmail: message.toEmail, subject: message.subject } })
            if (legacy) {
              await tx.emailMessage.update({ where: { id: legacy.id }, data: { accountId, replyMetadata: message as unknown as Prisma.InputJsonValue } })
              return { fresh: false, reply: message }
            }
          }
          const emailMessage = await tx.emailMessage.create({
            data: tenantData({
              accountId, externalId,
              threadId: message.threadId,
              fromEmail: message.fromEmail,
              toEmail: message.toEmail,
              subject: message.subject,
              bodyPreview: message.bodyPreview?.substring(0, 200) ?? null,
              sentAt,
              replyMetadata: message as unknown as Prisma.InputJsonValue,
            }),
          })
          const matchEmail = message.fromEmail.toLowerCase() === account.email.toLowerCase() ? message.toEmail : message.fromEmail
          if (matchEmail) {
            const leads = await tx.lead.findMany({
              where: { deletedAt: null, OR: [{ email: { equals: matchEmail, mode: 'insensitive' } }, { altEmail: { equals: matchEmail, mode: 'insensitive' } }] },
              select: { id: true }, take: 2,
            })
            if (leads.length === 1) {
              const lead = leads[0]
              await tx.activity.create({ data: tenantData({ type: 'EMAIL', leadId: lead.id, createdById: account.userId, notes: message.subject ? `Email: ${message.subject}` : 'Email', emailMessageId: emailMessage.id }) })
              await tx.lead.update({ where: { id: lead.id }, data: { lastActivityAt: sentAt } })
            }
          }
          return { fresh: true, reply: message }
        }, { timeout: 15000 })
        if (saved.fresh) synced++
        else skipped++
        if (saved.reply) replies.push(saved.reply)
      }

      if (account.provider === 'microsoft') {
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const messages = await listMicrosoftMessages(accessToken, sinceIso)
        for (const message of messages) await persist(message.externalId, async () => message)
      } else {
        const response = await fetch(`${GMAIL_API_BASE}/users/me/messages?maxResults=50&q=newer_than:1d`, { headers: { Authorization: `Bearer ${accessToken}` } })
        if (!response.ok) throw new Error(`Gmail messages.list failed: ${await response.text()}`)
        const data = (await response.json()) as GmailMessageListResponse
        for (const item of data.messages ?? []) {
          await persist(item.id, async () => {
            // Auto-response headers are necessary to avoid stopping outreach on
            // vacation notices, delivery failures, and mailing-list messages.
            const response = await fetch(`${GMAIL_API_BASE}/users/me/messages/${item.id}?format=metadata`, { headers: { Authorization: `Bearer ${accessToken}` } })
            if (!response.ok) return null
            const message = (await response.json()) as GmailMessageMetadataResponse
            const headers = message.payload.headers
            return {
              externalId: message.id, threadId: message.threadId,
              fromEmail: extractEmailAddress(getHeader(headers, 'From')),
              toEmail: extractEmailAddress(getHeader(headers, 'To')),
              recipientEmails: getHeader(headers, 'To').split(',').map(extractEmailAddress),
              subject: getHeader(headers, 'Subject'),
              bodyPreview: message.snippet?.substring(0, 200) ?? null,
              sentAt: new Date(Number(message.internalDate)).toISOString(),
              headers,
            }
          })
        }
      }
      return { synced, skipped, replies }
    })

    await step.run('reconcile-replies', () => reconcileEmailReplies(organizationId, accountId, result.replies))
    await step.run('update-last-sync', () => db.emailAccount.update({ where: { id: accountId }, data: { lastSyncAt: new Date() } }))
    return { synced: result.synced, skipped: result.skipped }
  },
)
