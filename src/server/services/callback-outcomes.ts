import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma, type CallbackOutcomeEvent } from '@prisma/client'
import { z, ZodError } from 'zod'
import { prisma } from '@/server/db/client'
import { callbackCalendarReviewRequired, preferredTimeSchema } from '@/lib/callback-time'
import { readCallbackCalendar, checkCallbackTime, validateCallbackInstant } from './callback-time'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import { websiteCallbackRecordSchema } from '@/lib/website-receptionist'
import { callbackOutcomeCommitSchema, callbackOutcomePreviewInputSchema, callbackOutcomeDetailSchema, callbackOutcomePreviewSchema, callbackOutcomeAckSchema, callbackOutcomeEventSchema, callbackOutcomeHistoryQuerySchema, callbackOutcomeQueueQuerySchema, callbackOutcomeQueueSchema } from '@/lib/callback-outcomes'

type Db = Prisma.TransactionClient
const id = z.string().uuid()
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const label = (value: string | null) => (value ?? '').replace(/[\0\r\n]/g, ' ').trim().slice(0, 512) || 'Staff member'
function fail(code: string, message: string, status = 409): never { throw new AppError(code, message, status) }
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action() } catch (error) { if (error instanceof AppError || error instanceof ZodError) throw error; throw new AppError('OUTCOME_UNAVAILABLE', 'The outcome could not be confirmed. Reload its status or retry the same confirmation.', 503) } }
async function authorize(organizationId: string, userId: string, db: Db = prisma) {
  const member = await db.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } }, select: { id: true } })
  const permissions = member ? await getEffectivePermissions(userId, organizationId) : new Set<string>()
  if (!permissions.has('leads:read') || !permissions.has('leads:write')) fail('FORBIDDEN', 'Organization membership and CRM read/write permissions are required.', 403)
  return { isAdmin: permissions.has('admin:settings') }
}
async function context(organizationId: string, userId: string, callbackId: string, db: Db, isAdmin: boolean, lockCalendar = false) {
  const receipt = await db.callbackCrmHandoff.findFirst({ where: { callbackId, organizationId } })
  if (!receipt) fail('NOT_FOUND', 'Callback CRM handoff not found.', 404)
  const [task, lead, source, latest, closed, members] = await Promise.all([
    db.task.findFirst({ where: { id: receipt.taskId, leadId: receipt.leadId, organizationId }, include: { assignee: { select: { name: true } } } }),
    db.lead.findFirst({ where: { id: receipt.leadId, organizationId }, select: { id: true, updatedAt: true, deletedAt: true, isClosed: true } }),
    db.websiteReceptionistCallback.findFirst({ where: { id: callbackId, organizationId } }),
    db.callbackOutcomeEvent.findFirst({ where: { callbackId, organizationId }, orderBy: { sequence: 'desc' } }),
    db.callbackOutcomeEvent.findFirst({ where: { callbackId, organizationId, action: 'close' }, select: { id: true } }),
    db.organizationMember.findMany({ where: { organizationId }, include: { user: { select: { name: true } } }, orderBy: { userId: 'asc' }, take: 201 }),
  ])
  if (!isAdmin && task?.assigneeId !== userId) fail('FORBIDDEN', 'Only the current callback owner or an organization administrator can manage this request.', 403)
  const leadAvailable = !!lead && !lead.deletedAt && !lead.isClosed
  const availableTask = task && leadAvailable ? task : null
  const preference = receipt.preferredTime || source?.preferredTime
  const preferredTime = preference ? preferredTimeSchema.parse(preference) : undefined
  const callbackHours = preferredTime ? await readCallbackCalendar(organizationId, db, lockCalendar) : null
  const version = hash({ receipt, task, lead, source, sequence: latest?.sequence ?? 0, closed: !!closed, members, ...(callbackHours ? { callbackHours } : {}) })
  return { receipt, task: availableTask, source, leadAvailable, closed: !!closed, latest, members, version, preferredTime, callbackHours }
}
function sourceView(source: NonNullable<Awaited<ReturnType<typeof context>>['source']>) {
  return websiteCallbackRecordSchema.parse({ id: source.id, fullName: source.fullName, phone: source.phone, reason: source.reason, siteOrigin: source.siteOrigin, status: source.status, consentedAt: source.consentedAt.toISOString(), createdAt: source.createdAt.toISOString(), updatedAt: source.updatedAt.toISOString(), ...(source.preferredTime ? { preferredTime: preferredTimeSchema.parse(source.preferredTime) } : {}) })
}
function eventView(row: CallbackOutcomeEvent) { return callbackOutcomeEventSchema.parse({ id: row.id, sequence: row.sequence, outcome: row.outcome, action: row.action, notes: row.notes, createdAt: row.createdAt.toISOString(), createdByName: row.createdByName, assigneeName: row.assigneeName, dueDate: row.dueDate?.toISOString() ?? null }) }
export async function getCallbackOutcome(organizationId: string, userId: string, callbackId: string, raw: unknown) {
  return safe(async () => {
    id.parse(callbackId); const query = callbackOutcomeHistoryQuerySchema.parse(raw), auth = await authorize(organizationId, userId)
    return prisma.$transaction(async db => {
      const ctx = await context(organizationId, userId, callbackId, db, auth.isAdmin)
      const rows = await db.callbackOutcomeEvent.findMany({ where: { organizationId, callbackId, ...(query.before ? { sequence: { lt: query.before } } : {}) }, orderBy: { sequence: 'desc' }, take: 21 })
      return callbackOutcomeDetailSchema.parse({ callbackId, taskId: ctx.receipt.taskId, version: ctx.version, source: ctx.source ? sourceView(ctx.source) : null, ...(ctx.preferredTime ? { preferredTime: ctx.preferredTime } : {}), ...(ctx.callbackHours ? { callbackHours: ctx.callbackHours } : {}), ...(ctx.preferredTime && ctx.task && !ctx.task.isComplete && !ctx.closed && callbackCalendarReviewRequired(ctx.task.dueDate.toISOString(), ctx.callbackHours) ? { calendarReviewRequired: true } : {}), closed: ctx.closed, canEdit: !!ctx.task && !ctx.closed, leadAvailable: ctx.leadAvailable,
        task: ctx.task ? { id: ctx.task.id, title: ctx.task.title, dueDate: ctx.task.dueDate.toISOString(), assigneeId: ctx.task.assigneeId, assigneeName: label(ctx.task.assignee.name), isComplete: ctx.task.isComplete } : null,
        members: ctx.members.slice(0, 200).map(row => ({ id: row.userId, label: label(row.user.name) })), membersTruncated: ctx.members.length > 200,
        history: rows.slice(0, 20).map(eventView), hasMore: rows.length > 20, beforeNext: rows.length > 20 ? rows[19].sequence : null })
    }, { isolationLevel: 'RepeatableRead' })
  })
}
async function preview(organizationId: string, userId: string, callbackId: string, raw: unknown, db: Db, isAdmin: boolean, lockCalendar = false) {
  const input = callbackOutcomePreviewInputSchema.parse(raw), ctx = await context(organizationId, userId, callbackId, db, isAdmin, lockCalendar)
  if (ctx.version !== input.expectedVersion) fail('OUTCOME_CONFLICT', 'The callback, task, or history changed. Reload and review the current state.')
  if (!ctx.task || ctx.closed) fail('OUTCOME_CLOSED', 'This request is closed or its CRM task is unavailable. No records will be recreated.')
  const { draft } = input
  const member = draft.assigneeId ? ctx.members.find(row => row.userId === draft.assigneeId) : null
  if (draft.action === 'reschedule' && (!member || !draft.dueDate || !Number.isFinite(Date.parse(draft.dueDate)) || Date.parse(draft.dueDate) <= Date.now())) fail('OUTCOME_INVALID', 'Choose a current organization member and a future deadline.', 400)
  const confirmedTime = draft.action === 'reschedule' && ctx.preferredTime ? checkCallbackTime(ctx.callbackHours, calendar => validateCallbackInstant(draft.dueDate!, calendar)) : undefined
  const nextOwner = member ? label(member.user.name) : null, nextDueDate = draft.dueDate ? new Date(draft.dueDate).toISOString() : null
  const taskChange = draft.action === 'close' ? 'Complete the existing task. No new task will be created.' : draft.action === 'reschedule' ? 'Update the existing task owner and deadline and leave it open.' : 'Keep the task owner, deadline and completion unchanged.'
  const sourceChange = draft.action === 'close' ? ctx.source ? 'Mark the source callback reviewed and close its request lifecycle.' : 'The source callback was removed. Close the retained request lifecycle.' : 'Keep callback review status unchanged.'
  const reopensTask = draft.action === 'reschedule' && ctx.task.isComplete
  return callbackOutcomePreviewSchema.parse({ ...input, callbackId, version: hash({ input, callbackId, nextOwner, nextDueDate, taskChange, sourceChange, reopensTask }), taskTitle: ctx.task.title, taskChange, sourceChange, nextOwner, nextDueDate, reopensTask, ...(confirmedTime ? { confirmedTime } : {}) })
}
export async function previewCallbackOutcome(organizationId: string, userId: string, callbackId: string, raw: unknown) { return safe(async () => { id.parse(callbackId); const auth = await authorize(organizationId, userId); return prisma.$transaction(db => preview(organizationId, userId, callbackId, raw, db, auth.isAdmin), { isolationLevel: 'RepeatableRead' }) }) }
export async function resolveCallbackOutcomeTask(organizationId: string, userId: string, taskId: string) {
  return safe(async () => { id.parse(taskId); await authorize(organizationId, userId); const receipt = await prisma.callbackCrmHandoff.findFirst({ where: { organizationId, taskId }, select: { callbackId: true } }); if (!receipt) fail('NOT_FOUND', 'Callback CRM handoff not found.', 404); return receipt.callbackId })
}
export async function recordCallbackOutcome(organizationId: string, userId: string, callbackId: string, raw: unknown) {
  return safe(async () => {
    id.parse(callbackId); const input = callbackOutcomeCommitSchema.parse(raw); await authorize(organizationId, userId)
    const requestHash = hash({ callbackId, input })
    return prisma.$transaction(async db => {
      const memberIds = [...new Set([userId, ...(input.draft.assigneeId ? [input.draft.assigneeId] : [])])].sort()
      const members = await db.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId" IN (${Prisma.join(memberIds)}) ORDER BY "userId" FOR SHARE`)
      const auth = await authorize(organizationId, userId, db)
      const receipts = await db.$queryRaw<{ taskId: string; leadId: string }[]>`SELECT "taskId","leadId" FROM "CallbackCrmHandoff" WHERE "organizationId"=${organizationId} AND "callbackId"=${callbackId} FOR UPDATE`
      if (!receipts[0]) fail('NOT_FOUND', 'Callback CRM handoff not found.', 404)
      const prior = await db.callbackOutcomeEvent.findUnique({ where: { organizationId_id: { organizationId, id: input.requestId } } })
      if (prior) {
        if (prior.createdById !== userId && !auth.isAdmin) fail('FORBIDDEN', 'This confirmation belongs to another staff member.', 403)
        if (prior.requestHash !== requestHash || prior.callbackId !== callbackId) fail('OUTCOME_CONFLICT', 'This confirmation ID was already used. Reload the current outcome.')
        return callbackOutcomeAckSchema.parse({ recorded: true, callbackId, requestId: prior.id, action: prior.action })
      }
      const receipt = receipts[0]
      // Same task → lead lock order as normal task completion.
      await db.$queryRaw`SELECT id FROM "Task" WHERE id=${receipt.taskId} AND "organizationId"=${organizationId} FOR UPDATE`
      await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${receipt.leadId} AND "organizationId"=${organizationId} FOR UPDATE`
      await db.$queryRaw`SELECT id FROM "WebsiteReceptionistCallback" WHERE id=${callbackId} AND "organizationId"=${organizationId} FOR UPDATE`
      if (input.draft.assigneeId && !members.some(row => row.userId === input.draft.assigneeId)) fail('OUTCOME_INVALID', 'Choose a current organization member.', 400)
      const reviewed = await preview(organizationId, userId, callbackId, { draft: input.draft, expectedVersion: input.expectedVersion }, db, auth.isAdmin, true)
      if (reviewed.version !== input.previewVersion) fail('OUTCOME_CONFLICT', 'The reviewed action changed. Reload and preview again.')
      const latest = await db.callbackOutcomeEvent.findFirst({ where: { callbackId, organizationId }, orderBy: { sequence: 'desc' } })
      const actor = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }), now = new Date(), draft = reviewed.draft
      if (draft.action === 'reschedule') await db.task.update({ where: { id: receipt.taskId }, data: { assigneeId: draft.assigneeId!, dueDate: new Date(draft.dueDate!), isComplete: false, completedAt: null } })
      if (draft.action === 'close') {
        await db.task.updateMany({ where: { id: receipt.taskId, organizationId, isComplete: false }, data: { isComplete: true, completedAt: now } })
        await db.websiteReceptionistCallback.updateMany({ where: { id: callbackId, organizationId }, data: { status: 'reviewed', reviewedById: userId } })
      }
      const event = await db.callbackOutcomeEvent.create({ data: { organizationId, id: input.requestId, callbackId, sequence: (latest?.sequence ?? 0) + 1, outcome: draft.outcome, action: draft.action, notes: draft.notes, assigneeId: draft.assigneeId, assigneeName: reviewed.nextOwner, dueDate: reviewed.nextDueDate ? new Date(reviewed.nextDueDate) : null, createdById: userId, createdByName: label(actor.name), requestHash } })
      const result = { reached: 'Reached', no_answer: 'No answer', retry: 'Needs another attempt' }[draft.outcome]
      await db.activity.create({ data: { organizationId, leadId: receipt.leadId, createdById: userId, type: 'NOTE', notes: `Staff-reported callback outcome: ${result}. Action: ${draft.action}.\n${draft.notes}\nCallback: ${callbackId}` } })
      await db.lead.update({ where: { id: receipt.leadId }, data: { lastActivityAt: now } })
      return callbackOutcomeAckSchema.parse({ recorded: true, callbackId, requestId: event.id, action: draft.action })
    }, { timeout: 10000 })
  })
}
export async function listCallbackOutcomeQueue(organizationId: string, userId: string, raw: unknown) {
  return safe(async () => {
    const query = callbackOutcomeQueueQuerySchema.parse(raw), auth = await authorize(organizationId, userId)
    const closed = Prisma.sql`EXISTS (SELECT 1 FROM "CallbackOutcomeEvent" e WHERE e."organizationId"=h."organizationId" AND e."callbackId"=h."callbackId" AND e.action='close')`
    const filter = query.filter === 'closed' ? closed : query.filter === 'all' ? Prisma.sql`TRUE` : Prisma.sql`NOT ${closed}${query.filter === 'overdue' ? Prisma.sql` AND NOT t."isComplete" AND t."dueDate" < ${new Date()}` : Prisma.empty}`
    const rows = await prisma.$queryRaw<{ callbackId: string; taskId: string; title: string; assigneeName: string; dueDate: Date; isComplete: boolean; closed: boolean; latestOutcome: string | null }[]>(Prisma.sql`
      SELECT h."callbackId", t.id AS "taskId", t.title, u.name AS "assigneeName", t."dueDate", t."isComplete", ${closed} AS closed,
        (SELECT e.outcome FROM "CallbackOutcomeEvent" e WHERE e."organizationId"=h."organizationId" AND e."callbackId"=h."callbackId" ORDER BY e.sequence DESC LIMIT 1) AS "latestOutcome"
      FROM "CallbackCrmHandoff" h JOIN "Task" t ON t.id=h."taskId" AND t."organizationId"=h."organizationId" AND t."leadId"=h."leadId"
      JOIN "Lead" l ON l.id=h."leadId" AND l."organizationId"=h."organizationId" JOIN "User" u ON u.id=t."assigneeId"
      WHERE h."organizationId"=${organizationId} AND l."deletedAt" IS NULL AND NOT l."isClosed" AND ${filter} ${auth.isAdmin ? Prisma.empty : Prisma.sql`AND t."assigneeId"=${userId}`}
      ORDER BY t."dueDate", h."callbackId" OFFSET ${(query.page - 1) * 20} LIMIT 21`)
    return callbackOutcomeQueueSchema.parse({ rows: rows.slice(0, 20).map(row => ({ ...row, dueDate: row.dueDate.toISOString(), assigneeName: label(row.assigneeName) })), page: query.page, hasMore: rows.length > 20 })
  })
}
