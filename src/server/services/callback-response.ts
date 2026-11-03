import 'server-only'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { businessHoursSchema, responsePolicyMetadataSchema, responsePolicyWriteSchema, responseTargetListSchema, responseTargetQuerySchema, supportedTarget } from '@/lib/callback-response'
import { callbackAccess, callbackRecipientsSql } from './callback-access'
import { currentResponseTargetsSql } from './callback-response-sql'
type Db = Prisma.TransactionClient
async function admin(org: string, user: string, db: Db = prisma) { if (!(await callbackAccess(org, user, db)).admin) throw new AppError('FORBIDDEN', 'Organization settings access is required.', 403) }
function conflict(message = 'The saved policy or business hours changed. Reload before saving; your edits can be kept.'): never { throw new AppError('RESPONSE_CONFLICT', message, 409) }
async function safe<T>(run: () => Promise<T>) { try { return await run() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') conflict(); throw new AppError('RESPONSE_UNAVAILABLE', 'Callback response targets are unavailable. Refresh and try again.', 503) } }
function business(settings: Prisma.JsonValue | undefined, updatedAt: Date | undefined) {
  const values = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const parsed = businessHoursSchema.safeParse({ timeZone: values.timeZone, opensAt: values.opensAt, closesAt: values.closesAt, businessDays: Array.isArray(values.businessDays) ? [...new Set(values.businessDays)].sort() : values.businessDays })
  return { businessName: typeof values.businessName === 'string' ? values.businessName.trim().slice(0, 120) : '', hours: parsed.success ? parsed.data : null, updatedAt: updatedAt?.toISOString() ?? null }
}
async function metadata(org: string, db: Db) {
  const [stored, source] = await Promise.all([db.callbackResponsePolicy.findUnique({ where: { organizationId: org } }), db.receptionistConfig.findUnique({ where: { organizationId: org }, select: { settings: true, updatedAt: true } })])
  const parsed = businessHoursSchema.safeParse(stored?.hours), current = business(source?.settings, source?.updatedAt)
  const managers = await db.$queryRaw<Array<{ id: string; name: string }>>`SELECT r."userId" AS id,u.name FROM (${callbackRecipientsSql(org)}) r JOIN "User" u ON u.id=r."userId" WHERE r.admin AND r.crm ORDER BY CASE WHEN r."userId"=${stored?.backupUserId ?? ''} THEN 0 ELSE 1 END,r."userId" LIMIT 201`
  return responsePolicyMetadataSchema.parse({ policy: { enabled: stored?.enabled ?? false, handoffMinutes: stored?.handoffMinutes ?? 60, attemptMinutes: stored?.attemptMinutes ?? 120, backupUserId: stored?.backupUserId ?? null, hours: parsed.success ? parsed.data : null, updatedAt: stored?.updatedAt.toISOString() ?? null, businessUpdatedAt: stored?.businessUpdatedAt?.toISOString() ?? null, lastCheckedAt: stored?.lastCheckedAt?.toISOString() ?? null }, business: current,
    managers: managers.slice(0, 200).map(row => ({ ...row, name: row.name.trim().slice(0, 100) || 'Organization member' })), managersTruncated: managers.length > 200, managerAvailable: !!stored?.backupUserId && managers.some(row => row.id === stored.backupUserId), hoursChanged: !!stored && JSON.stringify(parsed.success ? parsed.data : null) !== JSON.stringify(current.hours),
  })
}
export async function getCallbackResponsePolicy(org: string, user: string) { return safe(async () => { await admin(org, user); return prisma.$transaction(async db => { await admin(org, user, db); return metadata(org, db) }, { isolationLevel: 'RepeatableRead' }) }) }
export async function saveCallbackResponsePolicy(org: string, user: string, raw: unknown) {
  return safe(async () => {
    await admin(org, user); const input = responsePolicyWriteSchema.parse(raw)
    return prisma.$transaction(async db => {
      await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${org} FOR NO KEY UPDATE`
      await db.$queryRaw`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId"=${org} AND "userId" IN (${user},${input.backupUserId ?? ''}) ORDER BY "userId" FOR SHARE`
      await db.$queryRaw`SELECT id FROM "ReceptionistConfig" WHERE "organizationId"=${org} FOR SHARE`
      await admin(org, user, db)
      const [stored, source] = await Promise.all([db.callbackResponsePolicy.findUnique({ where: { organizationId: org } }), db.receptionistConfig.findUnique({ where: { organizationId: org }, select: { settings: true, updatedAt: true } })])
      if ((stored?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt) conflict()
      const current = business(source?.settings, source?.updatedAt)
      if (input.enabled) {
        if (current.updatedAt !== input.expectedBusinessUpdatedAt) conflict()
        if (!current.hours || !source) throw new AppError('RESPONSE_INVALID', 'Save valid weekly business hours in receptionist settings first.', 400)
        if (!supportedTarget(current.hours, input.handoffMinutes) || !supportedTarget(current.hours, input.attemptMinutes)) throw new AppError('RESPONSE_INVALID', 'The target is too large for this weekly schedule. Choose a shorter target or extend the opening hours.', 400)
        const [recipient] = await db.$queryRaw<Array<{ admin: boolean; crm: boolean }>>`${callbackRecipientsSql(org, input.backupUserId!)}`
        if (!recipient?.admin || !recipient.crm) throw new AppError('RESPONSE_INVALID', 'Choose a current manager with settings and CRM read/write access.', 400)
      }
      const { expectedUpdatedAt: _version, expectedBusinessUpdatedAt: _businessVersion, acknowledged: _ack, ...values } = input
      const hours = input.enabled ? current.hours! : stored?.hours ?? current.hours
      const previousHours = businessHoursSchema.safeParse(stored?.hours), nextHours = businessHoursSchema.safeParse(hours)
      const sameHours = JSON.stringify(previousHours.success ? previousHours.data : stored?.hours ?? null) === JSON.stringify(nextHours.success ? nextHours.data : hours ?? null)
      if (stored && stored.enabled === values.enabled && stored.handoffMinutes === values.handoffMinutes && stored.attemptMinutes === values.attemptMinutes && stored.backupUserId === values.backupUserId && sameHours) return metadata(org, db)
      const data = { ...values, hours: hours ?? Prisma.DbNull, businessUpdatedAt: input.enabled ? source!.updatedAt : stored?.businessUpdatedAt ?? source?.updatedAt ?? null, updatedAt: new Date(Math.max(Date.now(), (stored?.updatedAt.getTime() ?? 0) + 1)), lastCheckedAt: null }
      if (stored) await db.callbackResponsePolicy.update({ where: { organizationId: org }, data })
      else await db.callbackResponsePolicy.create({ data: { organizationId: org, ...data } })
      return metadata(org, db)
    }, { timeout: 15000 })
  })
}
export async function listCallbackResponseTargets(org: string, user: string, raw: unknown) {
  return safe(async () => {
    const input = responseTargetQuerySchema.parse(raw); await callbackAccess(org, user); const now = new Date()
    const rows = await prisma.$queryRaw<Array<{ callbackId: string; phase: string; startedAt: Date; dueAt: Date; taskId: string | null; assigneeName: string | null; missed: boolean }>>`
      SELECT target."callbackId",target.phase,target."startedAt",target."dueAt",target."taskId",target."assigneeName",target."dueAt"<${now} AS missed
      FROM (${currentResponseTargetsSql(org)}) target CROSS JOIN (${callbackRecipientsSql(org, user)}) access
      WHERE ((target.phase='handoff' AND access.admin) OR (target.phase='attempt' AND access.crm AND (access.admin OR target."assigneeId"=${user})))
        ${input.filter === 'missed' ? Prisma.sql`AND target."dueAt"<${now}` : Prisma.empty}
      ORDER BY target."dueAt",target."callbackId",target.phase LIMIT 21 OFFSET ${(input.page - 1) * 20}`
    const policy = await prisma.callbackResponsePolicy.findUnique({ where: { organizationId: org }, select: { enabled: true } })
    return responseTargetListSchema.parse({ rows: rows.slice(0, 20).map(row => ({ ...row, startedAt: row.startedAt.toISOString(), dueAt: row.dueAt.toISOString(), assigneeName: row.assigneeName === null ? null : row.assigneeName.trim().slice(0, 100) || 'Organization member' })), page: input.page, hasMore: rows.length > 20, policyEnabled: !!policy?.enabled })
  })
}
