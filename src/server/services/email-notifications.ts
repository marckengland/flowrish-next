import 'server-only'
import { Prisma, type FollowUpSuggestion } from '@prisma/client'
import { z, ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { emailNotificationAck, emailNotificationCount, emailNotificationKey, emailNotificationList, emailNotificationQuery } from '@/lib/email-notifications'
import { hasPermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from './access'
import { emailNotificationSources } from './email-notification-sources'
const missing = () => new AppError('NOT_FOUND', 'This email notification is no longer available. Refresh to see current work.', 404)
async function access(db: Prisma.TransactionClient, organizationId: string, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { organizationMemberships: true, teamMemberships: { where: { team: { organizationId } }, include: { team: true, role: { include: { permissions: true } } } } } })
  if (!user?.organizationMemberships.some(row => row.organizationId === organizationId)) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
  return hasPermission(user, 'leads:read') ? getLeadAccessFilter(user, organizationId) : null
}
async function safe<T>(run: () => Promise<T>) { try { return await run() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; throw new AppError('EMAIL_NOTIFICATIONS_UNAVAILABLE', 'Email notifications are unavailable. Refresh or retry the same acknowledgment.', 503) } }
export async function countEmailNotifications(organizationId: string, userId: string) {
  return safe(() => prisma.$transaction(async db => {
    const filter = await access(db, organizationId, userId); if (!filter) return { unread: 0 }
    const [row] = await db.$queryRaw<Array<{ unread: number }>>(Prisma.sql`${emailNotificationSources(organizationId, userId, filter)} SELECT count(*)::int AS unread FROM candidates c LEFT JOIN "EmailNotificationRead" r ON r."organizationId"=${organizationId} AND r."userId"=${userId} AND r.key=c.key WHERE r."readAt" IS NULL`)
    return emailNotificationCount.parse(row)
  }))
}
export async function listEmailNotifications(organizationId: string, userId: string, raw: unknown) {
  const input = emailNotificationQuery.parse(raw)
  return safe(() => prisma.$transaction(async db => {
    const filter = await access(db, organizationId, userId); if (!filter) return { rows: [], page: input.page, hasMore: false }
    const rows = await db.$queryRaw<Array<{ key: string; kind: string; messageId: string; followUpId: string | null; createdAt: Date; readAt: Date | null }>>(Prisma.sql`${emailNotificationSources(organizationId, userId, filter)}
      SELECT c.key,c.kind,c."messageId",c."followUpId",c."createdAt",r."readAt" FROM candidates c LEFT JOIN "EmailNotificationRead" r ON r."organizationId"=${organizationId} AND r."userId"=${userId} AND r.key=c.key
      ${input.filter === 'unread' ? Prisma.sql`WHERE r."readAt" IS NULL` : Prisma.empty} ORDER BY c."createdAt" DESC,c.key DESC LIMIT 21 OFFSET ${(input.page - 1) * 20}`)
    return emailNotificationList.parse({ rows: rows.slice(0, 20).map(row => ({ ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })), page: input.page, hasMore: rows.length > 20 })
  }))
}
export async function readEmailNotification(organizationId: string, userId: string, key: string) {
  emailNotificationKey.parse(key)
  return safe(() => prisma.$transaction(async db => {
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, userId, key])},0))::text`
    const member = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${userId} FOR KEY SHARE`
    if (!member.length) throw new AppError('FORBIDDEN', 'Current business membership is required.', 403)
    const eligible = async () => {
      const filter = await access(db, organizationId, userId)
      if (!filter) throw new AppError('FORBIDDEN', 'Lead reading permission is required.', 403)
      const [row] = await db.$queryRaw<Array<{ key: string }>>(Prisma.sql`${emailNotificationSources(organizationId, userId, filter)} SELECT key FROM candidates WHERE key=${key} LIMIT 1`)
      if (!row) throw missing()
    }
    await eligible()
    await db.emailNotificationRead.createMany({ data: { organizationId, userId, key }, skipDuplicates: true })
    await eligible()
    const receipt = await db.emailNotificationRead.findUnique({ where: { organizationId_userId_key: { organizationId, userId, key } } })
    if (!receipt) throw missing()
    return emailNotificationAck.parse({ key: receipt.key, readAt: receipt.readAt.toISOString() })
  }, { timeout: 20000 }))
}
const publicDraft = z.object({ accountId: z.string(), provider: z.enum(['gmail', 'microsoft']), threadId: z.string(), recipientEmail: z.string().email(), mailboxEmail: z.string().email(), messageCount: z.number().int().positive(), lastMessageAt: z.string() })
export async function focusedEmailFollowUp(organizationId: string, userId: string, id: string) {
  z.string().uuid().parse(id)
  return safe(() => prisma.$transaction(async db => {
    const filter = await access(db, organizationId, userId); if (!filter) throw missing()
    const [row] = await db.$queryRaw<Array<FollowUpSuggestion & { lead: { id: string; firstName: string; lastName: string; email: string | null } }>>(Prisma.sql`${emailNotificationSources(organizationId, userId, filter)} SELECT f.*,jsonb_build_object('id',l.id,'firstName',l."firstName",'lastName',l."lastName",'email',l.email) AS lead FROM candidates c JOIN "FollowUpSuggestion" f ON f.id=c."followUpId" JOIN "Lead" l ON l.id=f."leadId" WHERE c.kind='email_reply' AND c."followUpId"=${id}`)
    if (!row) throw missing()
    const draft = publicDraft.safeParse(row.draftContext)
    return { ...row, draftContext: draft.success ? draft.data : null }
  }))
}
