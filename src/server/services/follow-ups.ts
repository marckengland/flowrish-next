import { z } from 'zod'
import { snoozeView } from './follow-up-snooze'
import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { currentFollowUpAccess, followUpLead, followUpUnavailable, followUpChanged, followUpView, lockFollowUpMember, requireFollowUpWrites, safeFollowUp } from './follow-up-access'

export { isHumanReply, type ReplyMessage } from './email-reply-types'
export { reconcileStoredEmailReplies as reconcileEmailReplies } from './email-routing'

export const followUpReviewSchema = z.object({
  action: z.enum(['approve', 'dismiss']),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
}).strict()

export async function reviewFollowUp(organizationId: string, userId: string, id: string, input: unknown) {
  const values = followUpReviewSchema.parse(input)
  requireFollowUpWrites()
  return safeFollowUp(() => prisma.$transaction(async tx => {
    await lockFollowUpMember(tx, organizationId, userId)
    await currentFollowUpAccess(tx, organizationId, userId, true)
    const where = { id, organizationId, assigneeId: userId }
    const before = await tx.followUpSuggestion.findFirst({ where })
    if (!before) throw followUpUnavailable()
    await tx.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
    if (before.taskId) await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${before.taskId} AND "organizationId"=${organizationId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`
    const suggestion = await tx.followUpSuggestion.findFirst({ where })
    if (!suggestion) throw followUpUnavailable()
    if (suggestion.leadId !== before.leadId || suggestion.taskId !== before.taskId || suggestion.sourceType !== before.sourceType || suggestion.sourceId !== before.sourceId) throw followUpChanged()
    const { lead } = await followUpLead(tx, organizationId, userId, suggestion.leadId, true)
    if (suggestion.status !== 'PENDING') return followUpView(suggestion, lead)
    let taskId = suggestion.taskId
    if (suggestion.sourceType === 'CALL' && !taskId) throw followUpUnavailable()
    if (taskId) {
      const task = await tx.task.findFirst({ where: { id: taskId, organizationId, assigneeId: userId, leadId: suggestion.leadId } })
      if (!task) throw followUpUnavailable()
    }
    const status = values.action === 'approve' ? 'APPROVED' : 'DISMISSED'
    const claim = await tx.followUpSuggestion.updateMany({ where: { ...where, status: 'PENDING' }, data: { status } })
    if (!claim.count) throw followUpChanged()
    if (status === 'APPROVED' && !taskId) {
      const task = await tx.task.create({ data: { organizationId, leadId: suggestion.leadId, assigneeId: userId, title: values.title ?? suggestion.title, description: values.description ?? suggestion.description, priority: 'MEDIUM', dueDate: values.dueDate ? new Date(values.dueDate) : new Date() } })
      taskId = task.id
    }
    const result = await tx.followUpSuggestion.update({ where: { id, organizationId, assigneeId: userId }, data: { taskId, ...(suggestion.taskId ? {} : { title: values.title ?? suggestion.title, description: values.description ?? suggestion.description }) } })
    await tx.auditEntry.create({ data: { organizationId, userId, action: 'UPDATE', entityType: 'FollowUpSuggestion', entityId: id, changes: { status, taskId } } })
    const final = await followUpLead(tx, organizationId, userId, suggestion.leadId, true)
    return followUpView(result, final.lead)
  }, { timeout: 20000 }))
}

/** Materializes authorized callback work; pending reviews follow their task owner. */
export async function listFollowUps(organizationId: string, userId: string, status = 'PENDING', retainedIds: readonly string[] = []) {
  const retained = z.array(z.string().min(1).max(128)).max(100).parse(retainedIds)
  if (!['PENDING', 'APPROVED', 'DISMISSED', 'SNOOZED'].includes(status)) throw new AppError('VALIDATION_ERROR', 'Invalid follow-up status', 400)
  return safeFollowUp(() => prisma.$transaction(async tx => {
    await lockFollowUpMember(tx, organizationId, userId)
    const access = await currentFollowUpAccess(tx, organizationId, userId)
    const owned = await tx.task.findMany({ where: { organizationId, assigneeId: userId, isComplete: false, lead: { organizationId, mergedIntoId: null, AND: [access.filter] } }, select: { id: true, leadId: true } })
    const touched = new Set<string>()
    const lockSource = async (leadId: string, taskId: string) => {
      const { lead } = await followUpLead(tx, organizationId, userId, leadId)
      const task = await tx.task.findFirst({ where: { id: taskId, organizationId, assigneeId: userId, isComplete: false, leadId: lead.id } })
      return task
    }
    const callbacks = await tx.receptionistCall.findMany({ where: { organizationId, status: 'completed', taskId: { in: owned.map(task => task.id) }, leadId: { not: null } }, orderBy: { createdAt: 'desc' }, take: 100 })
    const pending = owned.length ? await tx.followUpSuggestion.findMany({ where: { organizationId, sourceType: 'CALL', status: 'PENDING', taskId: { in: owned.map(task => task.id) }, assigneeId: { not: userId } }, orderBy: { id: 'asc' }, take: 100 }) : []
    const leadIds = [...new Set([...callbacks.map(row => row.leadId!), ...pending.map(row => row.leadId)])].sort()
    const taskIds = [...new Set([...callbacks.map(row => row.taskId!), ...pending.flatMap(row => row.taskId ? [row.taskId] : [])])].sort()
    // Match email routing's canonical lead order before taking any task/suggestion lock.
    if (leadIds.length) await tx.$queryRaw`SELECT id FROM "Lead" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(leadIds)}) ORDER BY id FOR SHARE`
    if (taskIds.length) await tx.$queryRaw`SELECT id FROM "Task" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(taskIds)}) ORDER BY id FOR UPDATE`
    for (const call of callbacks) {
      const task = await lockSource(call.leadId!, call.taskId!)
      if (!task) continue
      const current = await tx.receptionistCall.findFirst({ where: { id: call.id, organizationId, status: 'completed', taskId: task.id, leadId: task.leadId } })
      if (!current) continue
      const sourceKey = JSON.stringify(['call', call.id])
      await tx.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE "organizationId"=${organizationId} AND "sourceKey"=${sourceKey} FOR UPDATE`
      const created = await tx.followUpSuggestion.createMany({ data: { organizationId, assigneeId: userId, leadId: task.leadId!, sourceKey, sourceType: 'CALL', sourceId: call.id, sourceText: task.description ?? '', title: task.title, description: task.description ?? '', taskId: task.id }, skipDuplicates: true })
      if (created.count) touched.add(task.leadId!)
    }
    if (owned.length) {
      for (const row of pending) {
        if (row.sourceType !== 'CALL' || !row.taskId) continue
        const task = await lockSource(row.leadId, row.taskId)
        if (!task) continue
        await tx.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${row.id} AND "organizationId"=${organizationId} FOR UPDATE`
        const changed = await tx.followUpSuggestion.updateMany({ where: { id: row.id, organizationId, sourceType: 'CALL', status: 'PENDING', taskId: task.id, leadId: task.leadId, assigneeId: { not: userId } }, data: { assigneeId: userId } })
        if (changed.count) touched.add(task.leadId!)
      }
    }
    const final = await currentFollowUpAccess(tx, organizationId, userId)
    if (touched.size) {
      const allowed = await tx.lead.findMany({ where: { organizationId, id: { in: [...touched] }, mergedIntoId: null, AND: [final.filter] }, select: { id: true } })
      if (allowed.length !== touched.size) throw followUpUnavailable()
    }
    const assigned = final.filter.assignedUserId
    const leadScope = assigned === undefined ? Prisma.sql`TRUE` : typeof assigned === 'string' ? Prisma.sql`l."assignedUserId"=${assigned}` : assigned.in.length ? Prisma.sql`l."assignedUserId" IN (${Prisma.join(assigned.in)})` : Prisma.sql`FALSE`
    const retainScope = retained.length ? Prisma.sql`id IN (${Prisma.join(retained)})` : Prisma.sql`FALSE`
    // Apply lead and callback ownership eligibility before the page limit. Open
    // drafts/focused rows are revalidated independently of status and pagination.
    const view = status === 'SNOOZED' ? Prisma.sql`status='PENDING' AND until>timezone('UTC',statement_timestamp())` : status === 'PENDING' ? Prisma.sql`status='PENDING' AND (until IS NULL OR until<=timezone('UTC',statement_timestamp()))` : Prisma.sql`status=${status}`
    const eligible = await tx.$queryRaw<Array<{ id: string }>>`WITH eligible AS (
      SELECT f.id,f."createdAt",f.status,s.until FROM "FollowUpSuggestion" f
      LEFT JOIN "FollowUpSnooze" s ON s."organizationId"=f."organizationId" AND s."userId"=${userId} AND s."followUpId"=f.id
      JOIN "Lead" l ON l.id=f."leadId" AND l."organizationId"=${organizationId}
      WHERE f."organizationId"=${organizationId} AND f."assigneeId"=${userId}
        AND l."deletedAt" IS NULL AND l."mergedIntoId" IS NULL AND (${leadScope})
        AND (f.status<>'PENDING' OR (f."taskId" IS NULL AND f."sourceType"<>'CALL') OR EXISTS (
          SELECT 1 FROM "Task" t WHERE t.id=f."taskId" AND t."organizationId"=${organizationId}
            AND t."assigneeId"=${userId} AND t."leadId"=f."leadId" AND t."isComplete"=false))
    ), selected AS (
      (SELECT id,"createdAt" FROM eligible WHERE ${view} ORDER BY "createdAt" DESC,id LIMIT 100)
      UNION (SELECT id,"createdAt" FROM eligible WHERE ${retainScope})
    ) SELECT id FROM selected ORDER BY "createdAt" DESC,id`
    const rows = await tx.followUpSuggestion.findMany({ where: { organizationId, assigneeId: userId, id: { in: eligible.map(row => row.id) } }, orderBy: { createdAt: 'desc' } })
    const leads = await tx.lead.findMany({ where: { organizationId, mergedIntoId: null, id: { in: rows.map(row => row.leadId) }, AND: [final.filter] }, select: { id: true, firstName: true, lastName: true, email: true } })
    const tasks = await tx.task.findMany({ where: { organizationId, assigneeId: userId, isComplete: false, lead: { organizationId, mergedIntoId: null, AND: [final.filter] } }, select: { id: true, leadId: true } })
    const byId = new Map(leads.map(lead => [lead.id, lead])), taskById = new Map(tasks.map(task => [task.id, task.leadId]))
    const snoozes = await tx.followUpSnooze.findMany({ where: { organizationId, userId, followUpId: { in: rows.map(row => row.id) } } })
    const snoozeById = new Map(snoozes.map(row => [row.followUpId, row]))
    const items = rows.flatMap(row => {
      if (row.status === 'PENDING' && (row.taskId ? taskById.get(row.taskId) !== row.leadId : row.sourceType === 'CALL')) return []
      const lead = byId.get(row.leadId)
      return lead ? [snoozeView(followUpView(row, lead), snoozeById.get(row.id) ?? null)] : []
    })
    const current = await currentFollowUpAccess(tx, organizationId, userId)
    if (JSON.stringify(current.filter) !== JSON.stringify(final.filter)) throw followUpUnavailable()
    return { items, canWrite: current.canWrite }
  }, { timeout: 20000 }))
}
