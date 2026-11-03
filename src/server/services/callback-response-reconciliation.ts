import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { businessCalendar, businessHoursSchema } from '@/lib/callback-response'
import { responseSourcesSql } from './callback-response-sql'
import { reconcileCallbackNotifications } from './callback-notifications'
export async function reconcileCallbackResponseTargets(organizationId: string) {
  const policy = await prisma.callbackResponsePolicy.findUnique({ where: { organizationId } })
  if (!policy?.enabled) return { targets: 0, notifications: 0 }
  const deadline = businessCalendar(businessHoursSchema.parse(policy.hours)); let afterId = '', afterPhase = '', targets = 0
  for (;;) {
    const sources = await prisma.$queryRaw<Array<{ callbackId: string; phase: string; startedAt: Date; taskId: string | null }>>`SELECT "callbackId",phase,"startedAt","taskId" FROM (${responseSourcesSql(organizationId)}) source WHERE ("callbackId",phase)>(${afterId},${afterPhase}) ORDER BY "callbackId",phase LIMIT 100`
    if (!sources.length) break
    const checkedAt = new Date(), values = sources.map(row => Prisma.sql`(${organizationId},${row.callbackId},${row.phase},${row.startedAt},${deadline(row.startedAt, row.phase === 'handoff' ? policy.handoffMinutes : policy.attemptMinutes)},${policy.updatedAt},${row.taskId},${checkedAt})`)
    targets += await prisma.$executeRaw`INSERT INTO "CallbackResponseTarget" AS saved ("organizationId","callbackId",phase,"startedAt","dueAt","policyVersion","taskId","updatedAt") VALUES ${Prisma.join(values)}
      ON CONFLICT ("organizationId","callbackId",phase) DO UPDATE SET "startedAt"=EXCLUDED."startedAt","dueAt"=EXCLUDED."dueAt","policyVersion"=EXCLUDED."policyVersion","taskId"=EXCLUDED."taskId","updatedAt"=EXCLUDED."updatedAt"
      WHERE saved."policyVersion"<=EXCLUDED."policyVersion" AND (saved."startedAt",saved."dueAt",saved."policyVersion",saved."taskId") IS DISTINCT FROM (EXCLUDED."startedAt",EXCLUDED."dueAt",EXCLUDED."policyVersion",EXCLUDED."taskId")`
    afterId = sources[sources.length - 1].callbackId; afterPhase = sources[sources.length - 1].phase
  }
  // Health is not a configuration edit: never bump the policy version here.
  await prisma.$executeRaw`UPDATE "CallbackResponsePolicy" SET "lastCheckedAt"=${new Date()} WHERE "organizationId"=${organizationId} AND "updatedAt"=${policy.updatedAt} AND enabled`
  return { targets, notifications: await reconcileCallbackNotifications(organizationId) }
}
export async function reconcileCallbackResponsePage(after = '') {
  const batch = await prisma.callbackResponsePolicy.findMany({ where: { enabled: true, organizationId: { gt: after } }, select: { organizationId: true }, orderBy: { organizationId: 'asc' }, take: 25 })
  let targets = 0, notifications = 0
  for (const row of batch) { const result = await reconcileCallbackResponseTargets(row.organizationId); targets += result.targets; notifications += result.notifications }
  return { after: batch.length === 25 ? batch[batch.length - 1].organizationId : null, organizations: batch.length, targets, notifications }
}
