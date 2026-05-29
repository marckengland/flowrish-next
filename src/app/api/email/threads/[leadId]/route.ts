import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { getLeadAccessFilter } from '@/server/services/access'
import { AppError, errorResponse } from '@/lib/errors'

const paramsSchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
})

/**
 * GET /api/email/threads/[leadId] — Returns the lead's inbound /
 * outbound email messages grouped by Gmail threadId.
 *
 * The activity timeline already lists email activities individually,
 * but the threaded view (`EmailThread` component) wants conversations
 * collapsed under their subject so reps can scroll through replies in
 * context.
 *
 * Access control reuses the same RBAC filter as the lead detail page:
 * a user can only see threads for leads they can see.
 *
 * Validates: Requirements 7.3, 7.4
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { leadId } = paramsSchema.parse(await params)

    const accessFilter = await getLeadAccessFilter(
      session.dbUser,
      session.organizationId,
    )

    const db = createTenantPrisma(session.organizationId)

    // Verify the user can see this lead at all. We fail closed on
    // missing leads even when the email_message rows themselves are
    // tenant-scoped, because cross-tenant lookups are caught earlier
    // by the tenant prisma middleware but per-user RBAC is not.
    const lead = await db.lead.findFirst({
      where: { id: leadId, ...accessFilter, deletedAt: null },
      select: { id: true, email: true },
    })
    if (!lead) {
      throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
    }

    // Pull every message that touched this lead's email address. Both
    // directions are included so the thread view can show inbound
    // replies without a separate fetch.
    const leadEmail = lead.email?.toLowerCase()
    const messages = leadEmail
      ? await db.emailMessage.findMany({
          where: {
            OR: [
              { fromEmail: { equals: leadEmail, mode: 'insensitive' } },
              { toEmail: { equals: leadEmail, mode: 'insensitive' } },
            ],
          },
          orderBy: { sentAt: 'asc' },
          select: {
            id: true,
            externalId: true,
            threadId: true,
            fromEmail: true,
            toEmail: true,
            subject: true,
            bodyPreview: true,
            sentAt: true,
          },
        })
      : []

    // Group by threadId — Gmail conversations live on `threadId`. When
    // a message has no thread (e.g. an older row that pre-dates the
    // column) we synthesize one from the subject so it doesn't all
    // collapse into a single "no thread" bucket.
    const grouped = new Map<
      string,
      Array<typeof messages[number] & { isOutbound: boolean }>
    >()
    const userEmail = session.dbUser.email.toLowerCase()
    for (const msg of messages) {
      const key = msg.threadId ?? `subject:${msg.subject}`
      const list = grouped.get(key) ?? []
      list.push({
        ...msg,
        isOutbound: msg.fromEmail.toLowerCase() === userEmail,
      })
      grouped.set(key, list)
    }

    const data = Array.from(grouped.entries()).map(([threadId, msgs]) => ({
      threadId,
      messages: msgs.map((m) => ({
        id: m.id,
        externalId: m.externalId,
        threadId: m.threadId ?? threadId,
        fromEmail: m.fromEmail,
        toEmail: m.toEmail,
        subject: m.subject,
        bodyPreview: m.bodyPreview ?? '',
        sentAt: m.sentAt.toISOString(),
        isOutbound: m.isOutbound,
      })),
    }))

    // Newest activity first so the most recent thread renders at the top.
    data.sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.sentAt ?? ''
      const bLast = b.messages[b.messages.length - 1]?.sentAt ?? ''
      return bLast.localeCompare(aLast)
    })

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
