import 'server-only'
import { Prisma } from '@prisma/client'
import { ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { callbackNotificationAck, callbackNotificationCount, callbackNotificationKey, callbackNotificationList, callbackNotificationQuery } from '@/lib/callback-notifications'

// The current team-role permission union matches getEffectivePermissions. The
// same candidates drive delivery, unread counts, lists and mark-read access.
function candidates(organizationId: string, userId?: string) {
  const now = new Date()
  return Prisma.sql`WITH recipients AS (
    SELECT m."userId", COALESCE(bool_or(p.key='admin:settings'),false) AS admin,
      COALESCE(bool_or(p.key='leads:read') AND bool_or(p.key='leads:write'),false) AS crm
    FROM "OrganizationMember" m
    LEFT JOIN "TeamMember" tm ON tm."userId"=m."userId"
    LEFT JOIN "Team" t ON t.id=tm."teamId" AND t."organizationId"=${organizationId}
    LEFT JOIN "RolePermission" p ON p."roleId"=tm."roleId" AND t.id IS NOT NULL
    WHERE m."organizationId"=${organizationId} ${userId ? Prisma.sql`AND m."userId"=${userId}` : Prisma.empty}
    GROUP BY m."userId"
  ), events AS (
    SELECT r."userId", 'new_callback'::text AS kind, c.id AS "callbackId", NULL::text AS "taskId", c."updatedAt" AS "entityVersion", NULL::timestamp AS "dueDate"
    FROM "WebsiteReceptionistCallback" c CROSS JOIN recipients r
    WHERE c."organizationId"=${organizationId} AND c.status='pending' AND r.admin
      AND NOT EXISTS (SELECT 1 FROM "CallbackCrmHandoff" h WHERE h."organizationId"=${organizationId} AND h."callbackId"=c.id)
    UNION ALL
    SELECT r."userId", CASE WHEN t."dueDate"<${now} THEN 'overdue' ELSE 'assigned' END, h."callbackId", t.id, t."updatedAt", t."dueDate"
    FROM "CallbackCrmHandoff" h
    JOIN "Task" t ON t.id=h."taskId" AND t."organizationId"=${organizationId} AND t."leadId"=h."leadId"
    JOIN "Lead" l ON l.id=h."leadId" AND l."organizationId"=${organizationId}
    JOIN recipients r ON r."userId"=t."assigneeId" AND r.crm
    WHERE h."organizationId"=${organizationId} AND NOT t."isComplete" AND NOT l."isClosed" AND l."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "CallbackOutcomeEvent" e WHERE e."organizationId"=${organizationId} AND e."callbackId"=h."callbackId" AND e.action='close')
  ), candidates AS (
    SELECT e.*, encode(sha256(convert_to(jsonb_build_array(e.kind,e."callbackId",e."taskId",e."entityVersion")::text,'UTF8')),'hex') AS key FROM events e
  )`
}
async function member(organizationId: string, userId: string) {
  if (!await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })) throw new AppError('FORBIDDEN', 'Current organization membership is required.', 403)
}
async function safe<T>(run: () => Promise<T>) {
  try { return await run() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; throw new AppError('NOTIFICATIONS_UNAVAILABLE', 'Notifications are unavailable. Please refresh and try again.', 503) }
}
export async function reconcileCallbackNotifications(organizationId: string) {
  return prisma.$executeRaw`${candidates(organizationId)}
    INSERT INTO "CallbackNotification" ("organizationId","userId",key,kind,"callbackId","taskId","entityVersion","dueDate")
    SELECT ${organizationId},"userId",key,kind,"callbackId","taskId","entityVersion","dueDate" FROM candidates
    ON CONFLICT ("organizationId","userId",key) DO NOTHING`
}
export async function runCallbackNotificationSweep() {
  let after = '', organizations = 0, created = 0
  for (;;) {
    const batch = await prisma.organization.findMany({ where: { id: { gt: after }, OR: [{ websiteReceptionistCallbacks: { some: { status: 'pending' } } }, { callbackCrmHandoffs: { some: {} } }] }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 })
    if (!batch.length) return { organizations, created }
    for (const organization of batch) { created += await reconcileCallbackNotifications(organization.id); organizations++ }
    after = batch[batch.length - 1].id
  }
}
export async function getCallbackNotificationCount(organizationId: string, userId: string) {
  return safe(async () => {
    await member(organizationId, userId)
    const [row] = await prisma.$queryRaw<Array<{ unread: number }>>`${candidates(organizationId, userId)} SELECT count(*)::int AS unread FROM "CallbackNotification" n JOIN candidates c ON c.key=n.key AND c."userId"=n."userId" WHERE n."organizationId"=${organizationId} AND n."userId"=${userId} AND n."readAt" IS NULL`
    return callbackNotificationCount.parse(row)
  })
}
export async function listCallbackNotifications(organizationId: string, userId: string, raw: unknown) {
  return safe(async () => {
    const input = callbackNotificationQuery.parse(raw); await member(organizationId, userId)
    const rows = await prisma.$queryRaw<Array<{ key: string; kind: string; callbackId: string; taskId: string | null; dueDate: Date | null; createdAt: Date; readAt: Date | null }>>`${candidates(organizationId, userId)}
      SELECT n.key,n.kind,n."callbackId",n."taskId",n."dueDate",n."createdAt",n."readAt" FROM "CallbackNotification" n JOIN candidates c ON c.key=n.key AND c."userId"=n."userId"
      WHERE n."organizationId"=${organizationId} AND n."userId"=${userId} ${input.filter === 'unread' ? Prisma.sql`AND n."readAt" IS NULL` : Prisma.empty}
      ORDER BY n."createdAt" DESC,n.key DESC LIMIT 21 OFFSET ${(input.page - 1) * 20}`
    return callbackNotificationList.parse({ rows: rows.slice(0, 20).map(row => ({ ...row, dueDate: row.dueDate?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })), page: input.page, hasMore: rows.length > 20 })
  })
}
export async function readCallbackNotification(organizationId: string, userId: string, key: string) {
  return safe(async () => {
    callbackNotificationKey.parse(key); await member(organizationId, userId)
    const [row] = await prisma.$queryRaw<Array<{ key: string; readAt: Date }>>`${candidates(organizationId, userId)} UPDATE "CallbackNotification" n SET "readAt"=COALESCE(n."readAt",${new Date()}) FROM candidates c WHERE c.key=n.key AND c."userId"=n."userId" AND n."organizationId"=${organizationId} AND n."userId"=${userId} AND n.key=${key} RETURNING n.key,n."readAt"`
    if (!row) throw new AppError('NOT_FOUND', 'This notification is no longer available.', 404)
    return callbackNotificationAck.parse({ key: row.key, readAt: row.readAt.toISOString() })
  })
}
