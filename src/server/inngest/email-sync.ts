import { inngest } from './client'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { refreshTokenIfNeeded } from '@/server/services/email'
import { listMicrosoftMessages } from '@/server/services/microsoft-email'
import { decrypt } from '@/lib/encryption'

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

    // Step 1: Refresh token if needed and get account details
    const account = await step.run('refresh-token', async () => {
      await refreshTokenIfNeeded(accountId, organizationId)

      const acc = await db.emailAccount.findFirst({
        where: { id: accountId },
        select: {
          id: true,
          email: true,
          accessToken: true,
          provider: true,
        },
      })

      if (!acc) {
        throw new Error(`EmailAccount ${accountId} not found`)
      }

      return acc
    })

    // Microsoft mailboxes use a separate Graph-based path; the Gmail flow
    // that follows is left exactly as-is.
    if (account.provider === 'microsoft') {
      const accountEmail = account.email

      const rows = await step.run('ms-fetch-messages', async () => {
        const accessToken = decrypt(account.accessToken)
        const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        return listMicrosoftMessages(accessToken, sinceIso)
      })

      if (rows.length === 0) {
        await step.run('ms-update-last-sync-empty', async () => {
          await db.emailAccount.update({
            where: { id: accountId },
            data: { lastSyncAt: new Date() },
          })
        })
        return { synced: 0, skipped: 0 }
      }

      const results = await step.run('ms-process-messages', async () => {
        let synced = 0
        let skipped = 0

        const owner = await db.emailAccount.findFirst({
          where: { id: accountId },
          select: { userId: true },
        })

        for (const row of rows) {
          const existing = await db.emailMessage.findFirst({
            where: { externalId: row.externalId },
            select: { id: true },
          })
          if (existing) {
            skipped++
            continue
          }

          const sentAt = new Date(row.sentAt)
          const emailMessage = await db.emailMessage.create({
            data: tenantData({
              externalId: row.externalId,
              threadId: row.threadId,
              fromEmail: row.fromEmail,
              toEmail: row.toEmail,
              subject: row.subject,
              bodyPreview: row.bodyPreview?.substring(0, 200) ?? null,
              sentAt,
            }),
          })

          const matchEmail =
            row.fromEmail === accountEmail.toLowerCase() ? row.toEmail : row.fromEmail

          if (matchEmail && owner) {
            const lead = await db.lead.findFirst({
              where: {
                deletedAt: null,
                OR: [
                  { email: { equals: matchEmail, mode: 'insensitive' } },
                  { altEmail: { equals: matchEmail, mode: 'insensitive' } },
                ],
              },
              select: { id: true },
            })
            if (lead) {
              await db.activity.create({
                data: tenantData({
                  type: 'EMAIL',
                  leadId: lead.id,
                  createdById: owner.userId,
                  notes: row.subject ? `Email: ${row.subject}` : 'Email',
                  emailMessageId: emailMessage.id,
                }),
              })
              await db.lead.update({
                where: { id: lead.id },
                data: { lastActivityAt: sentAt },
              })
            }
          }

          synced++
        }

        return { synced, skipped }
      })

      await step.run('ms-update-last-sync', async () => {
        await db.emailAccount.update({
          where: { id: accountId },
          data: { lastSyncAt: new Date() },
        })
      })

      return results
    }

    // Step 2: Fetch recent message IDs from Gmail
    const messageIds = await step.run('fetch-message-list', async () => {
      const accessToken = decrypt(account.accessToken)

      const url = `${GMAIL_API_BASE}/users/me/messages?maxResults=50&q=newer_than:1d`
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Gmail messages.list failed: ${errorText}`)
      }

      const data = (await response.json()) as GmailMessageListResponse
      return data.messages ?? []
    })

    if (messageIds.length === 0) {
      // No new messages — update lastSyncAt and return
      await step.run('update-last-sync-empty', async () => {
        await db.emailAccount.update({
          where: { id: accountId },
          data: { lastSyncAt: new Date() },
        })
      })

      return { synced: 0, skipped: 0 }
    }

    // Step 3: For each message, fetch metadata and create EmailMessage record
    const results = await step.run('process-messages', async () => {
      const accessToken = decrypt(account.accessToken)

      let synced = 0
      let skipped = 0

      for (const msg of messageIds) {
        // Check if we already have this message (skip duplicates by externalId)
        const existing = await db.emailMessage.findFirst({
          where: { externalId: msg.id },
          select: { id: true },
        })

        if (existing) {
          skipped++
          continue
        }

        // Fetch message metadata from Gmail
        const msgUrl = `${GMAIL_API_BASE}/users/me/messages/${msg.id}?format=metadata`
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (!msgResponse.ok) {
          // Skip messages that fail to fetch — don't block the entire sync
          skipped++
          continue
        }

        const msgData = (await msgResponse.json()) as GmailMessageMetadataResponse

        const fromEmail = extractEmailAddress(
          getHeader(msgData.payload.headers, 'From'),
        )
        const toEmail = extractEmailAddress(
          getHeader(msgData.payload.headers, 'To'),
        )
        const subject = getHeader(msgData.payload.headers, 'Subject')
        const sentAt = new Date(parseInt(msgData.internalDate, 10))

        // Create EmailMessage record first so we can link the activity
        // back to it via the dedicated `emailMessageId` foreign key.
        // Note: organizationId is auto-injected by the tenant middleware at runtime
        const emailMessage = await db.emailMessage.create({
          data: tenantData({
            externalId: msgData.id,
            threadId: msgData.threadId,
            fromEmail,
            toEmail,
            subject,
            bodyPreview: msgData.snippet?.substring(0, 200) ?? null,
            sentAt,
          }),
        })

        // Link to lead by matching email address (from or to)
        const matchEmail = fromEmail === account.email.toLowerCase() ? toEmail : fromEmail
        if (matchEmail) {
          const lead = await db.lead.findFirst({
            where: {
              deletedAt: null,
              OR: [
                { email: { equals: matchEmail, mode: 'insensitive' } },
                { altEmail: { equals: matchEmail, mode: 'insensitive' } },
              ],
            },
            select: { id: true },
          })

          if (lead) {
            // Create an EMAIL activity linked to this lead and to the
            // EmailMessage we just persisted. The Activity model uses
            // `notes` for free-form copy and `emailMessageId` to thread
            // the activity to the actual message body.
            await db.activity.create({
              data: tenantData({
                type: 'EMAIL',
                leadId: lead.id,
                createdById: (await db.emailAccount.findFirst({
                  where: { id: accountId },
                  select: { userId: true },
                }))!.userId,
                notes: subject ? `Email: ${subject}` : 'Email',
                emailMessageId: emailMessage.id,
              }),
            })

            // Update lead's lastActivityAt
            await db.lead.update({
              where: { id: lead.id },
              data: { lastActivityAt: sentAt },
            })
          }
        }

        synced++
      }

      return { synced, skipped }
    })

    // Step 4: Update lastSyncAt on the EmailAccount
    await step.run('update-last-sync', async () => {
      await db.emailAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date() },
      })
    })

    return results
  },
)
