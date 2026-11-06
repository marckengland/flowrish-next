import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma, type FollowUpTaskBatch } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { taskCompletionInput } from '@/lib/follow-up-task-completion'
import { taskRescheduleInput } from '@/lib/follow-up-task-reschedule'
import { taskBatchRegistration, taskBatchAck, taskBatchDetail, taskBatchList, type TaskBatchRegistration } from '@/lib/follow-up-task-batches'
import { currentFollowUpAccess, followUpChanged, followUpUnavailable, lockFollowUpMember, requireFollowUpWrites, safeFollowUp } from './follow-up-access'
import { previewTaskCompletion } from './follow-up-task-completion'
import { previewTaskReschedule } from './follow-up-task-reschedule'
import { approvedTaskHash } from './follow-up-task-review'
import { followUpPageAccessVersion } from './follow-up-page-cursor'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const states = z.array(z.enum(['NOT_ATTEMPTED', 'UNCERTAIN', 'FAILED', 'CONFIRMED'])).min(1).max(20)
const owner = (organizationId: string, userId: string, id: string) => ({ id, organizationId, userId })
function registration(row: FollowUpTaskBatch) { return taskBatchRegistration.parse({ id: row.id, kind: row.kind, items: row.plan }) }
const ack = (row: FollowUpTaskBatch) => taskBatchAck.parse({ registration: registration(row), createdAt: row.createdAt.toISOString() })
async function lockBatch(db: Prisma.TransactionClient, organizationId: string, userId: string, id: string) {
 await lockFollowUpMember(db, organizationId, userId)
 await currentFollowUpAccess(db, organizationId, userId, true)
 await db.$queryRaw`SELECT id FROM "FollowUpTaskBatch" WHERE id=${id} AND "organizationId"=${organizationId} AND "userId"=${userId} FOR UPDATE`
 const row = await db.followUpTaskBatch.findFirst({ where: owner(organizationId, userId, id) })
 if (!row) throw followUpUnavailable()
 return row
}
export async function saveTaskBatch(organizationId: string, userId: string, raw: unknown) {
 const input = taskBatchRegistration.parse(raw), requestHash = digest({ kind: input.kind, items: input.items })
 requireFollowUpWrites()
 return safeFollowUp(async () => {
  const existing = await prisma.$transaction(async db => { await lockFollowUpMember(db, organizationId, userId); await currentFollowUpAccess(db, organizationId, userId, true); return db.followUpTaskBatch.findFirst({ where: owner(organizationId, userId, input.id) }) })
  if (existing) { if (existing.requestHash !== requestHash) throw followUpChanged(); return ack(existing) }
  for (const item of input.items) {
   if (input.kind === 'COMPLETE') {
    const review = await previewTaskCompletion(organizationId, userId, item.id)
    if (review.id !== item.id || review.version !== item.input.expectedVersion || review.task.id !== item.input.taskId) throw followUpChanged()
   } else {
    const entry = item as Extract<TaskBatchRegistration, { kind: 'RESCHEDULE' }>['items'][number]
    const review = await previewTaskReschedule(organizationId, userId, entry.id, { localTime: entry.input.localTime, timeZone: entry.input.timeZone })
    if (review.id !== entry.id || review.version !== entry.input.expectedVersion || review.task.id !== entry.input.taskId || review.task.dueDate !== entry.previousDueDate || review.newDueDate !== entry.dueDate) throw followUpChanged()
   }
  }
  return prisma.$transaction(async db => {
   await lockFollowUpMember(db, organizationId, userId); await currentFollowUpAccess(db, organizationId, userId, true)
   // A concurrent identical registration can safely return the same immutable intent.
   await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 86423))::text`
   const previous = await db.followUpTaskBatch.findFirst({ where: owner(organizationId, userId, input.id) })
   if (previous) { if (previous.requestHash !== requestHash) throw followUpChanged(); return ack(previous) }
   return ack(await db.followUpTaskBatch.create({ data: { id: input.id, organizationId, userId, kind: input.kind, requestHash, plan: input.items, progress: input.items.map(() => 'NOT_ATTEMPTED') } }))
  }, { timeout: 20000 })
 })
}
export async function withTaskBatchAttempt<T>(organizationId: string, userId: string, id: string, kind: 'COMPLETE' | 'RESCHEDULE', sourceId: string, raw: unknown, run: () => Promise<T>): Promise<T> {
 z.string().uuid().parse(id); requireFollowUpWrites()
 raw = kind === 'COMPLETE' ? taskCompletionInput.parse(raw) : taskRescheduleInput.parse(raw)
 const index = await safeFollowUp(() => prisma.$transaction(async db => {
  const row = await lockBatch(db, organizationId, userId, id), plan = registration(row), progress = states.parse(row.progress)
  const entry = plan.items[row.nextIndex]
  if (plan.kind !== kind || row.stopped || row.activeIndex !== null || !entry || entry.id !== sourceId || JSON.stringify(raw) !== JSON.stringify(entry.input) || progress[row.nextIndex] !== 'NOT_ATTEMPTED') throw followUpChanged()
  progress[row.nextIndex] = 'UNCERTAIN'
  await db.followUpTaskBatch.update({ where: owner(organizationId, userId, id), data: { progress, activeIndex: row.nextIndex } })
  return row.nextIndex
 }, { timeout: 20000 }))
 const finish = (state: 'CONFIRMED' | 'FAILED' | 'UNCERTAIN') => safeFollowUp(() => prisma.$transaction(async db => {
  const row = await lockBatch(db, organizationId, userId, id), progress = states.parse(row.progress)
  if (row.activeIndex !== index) throw followUpChanged()
  progress[index] = state
  await db.followUpTaskBatch.update({ where: owner(organizationId, userId, id), data: { progress, activeIndex: null, nextIndex: state === 'CONFIRMED' ? index + 1 : index, stopped: state !== 'CONFIRMED' } })
 }))
 try {
  const result = await run()
  // A successful HTTP operation must still contain this exact task's confirmation.
  const parsed = z.object({ id: z.literal(sourceId), requestId: z.literal(registrationRequest(raw)), state: z.literal('confirmed'), task: z.object({ id: z.literal(registrationTask(raw)) }) }).safeParse(result)
  if (!parsed.success) throw new AppError('FOLLOW_UP_UNAVAILABLE', 'The task change could not be confirmed. Check saved history.', 503)
  await finish('CONFIRMED')
  return result
 } catch (cause) {
  try { await finish(cause instanceof AppError && cause.statusCode >= 400 && cause.statusCode < 500 ? 'FAILED' : 'UNCERTAIN') } catch { /* The persisted started marker remains uncertain; exact audit proof is authoritative. */ }
  throw cause
 }
}
const registrationRequest = (raw: unknown) => z.object({ requestId: z.string().uuid() }).parse(raw).requestId
const registrationTask = (raw: unknown) => z.object({ taskId: z.string() }).parse(raw).taskId
const proof = z.object({ inputHash: z.string().regex(/^[a-f0-9]{64}$/), taskHash: z.string().regex(/^[a-f0-9]{64}$/), taskId: z.string(), previousDueDate: z.string().datetime().optional(), dueDate: z.string().datetime().optional() }).strict()
async function project(db: Prisma.TransactionClient, organizationId: string, userId: string, batches: FollowUpTaskBatch[]) {
 await lockFollowUpMember(db, organizationId, userId)
 const access = await currentFollowUpAccess(db, organizationId, userId, false), version = followUpPageAccessVersion(access.filter, access.taskScope)
 const plans = batches.map(registration), entries = plans.flatMap(row => row.items), sourceIds = entries.map(row => row.id)
 if (!entries.length) return []
 const where = { id: { in: sourceIds }, organizationId, assigneeId: userId, status: 'APPROVED' as const }
 const before = await db.followUpSuggestion.findMany({ where })
 const leadIds = [...new Set(before.map(row => row.leadId))].sort(), taskIds = [...new Set(before.flatMap(row => row.taskId ? [row.taskId] : []))].sort()
 // Match mutation lock order across all entries, not individual source order.
 if (leadIds.length) await db.$queryRaw(Prisma.sql`SELECT id FROM "Lead" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(leadIds)}) ORDER BY id FOR SHARE`)
 if (taskIds.length) await db.$queryRaw(Prisma.sql`SELECT id FROM "Task" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join(taskIds)}) ORDER BY id FOR SHARE`)
 await db.$queryRaw(Prisma.sql`SELECT id FROM "FollowUpSuggestion" WHERE "organizationId"=${organizationId} AND id IN (${Prisma.join([...new Set(sourceIds)].sort())}) ORDER BY id FOR SHARE`)
 const sources = await db.followUpSuggestion.findMany({ where }), leads = await db.lead.findMany({ where: { id: { in: leadIds }, organizationId, mergedIntoId: null, AND: [access.filter] }, select: { id: true, firstName: true, lastName: true } })
 const tasks = await db.task.findMany({ where: { id: { in: taskIds }, organizationId, ...access.taskScope } })
 const audits = await db.auditEntry.findMany({ where: { organizationId, userId, entityType: 'FollowUpSuggestion', action: 'UPDATE', id: { in: entries.map(row => row.input.requestId) } }, select: { id: true, entityId: true, changes: true } })
 const checkedAt = new Date().toISOString()
 const result = plans.map((plan, batchIndex) => {
  const progress = states.parse(batches[batchIndex].progress)
  return taskBatchDetail.parse({ id: plan.id, kind: plan.kind, createdAt: batches[batchIndex].createdAt.toISOString(), checkedAt, items: plan.items.map((entry, index) => {
   const source = sources.find(row => row.id === entry.id), prior = before.find(row => row.id === entry.id), task = tasks.find(row => row.id === entry.input.taskId), lead = leads.find(row => row.id === source?.leadId)
   if (!source || !prior || source.taskId !== prior.taskId || source.leadId !== prior.leadId || source.status !== 'APPROVED' || source.assigneeId !== userId || !task || !lead || task.id !== source.taskId || task.leadId !== source.leadId) return { index, state: 'unavailable' }
   const audit = audits.find(row => row.id === entry.input.requestId && row.entityId === entry.id)
   const changes = audit?.changes as Record<string, unknown> | undefined, parsed = proof.safeParse(changes?.[plan.kind === 'COMPLETE' ? 'taskCompletion' : 'taskReschedule'])
   const deadline = plan.kind === 'RESCHEDULE' ? plan.items[index] : null
   const confirmed = parsed.success && parsed.data.inputHash === digest(entry.input) && parsed.data.taskId === task.id && (!deadline || parsed.data.previousDueDate === deadline.previousDueDate && parsed.data.dueDate === deadline.dueDate)
   return { index, state: confirmed ? 'confirmed' : progress[index] === 'NOT_ATTEMPTED' ? 'not-attempted' : progress[index] === 'FAILED' ? 'failed' : 'uncertain', currentChanged: Boolean(confirmed && parsed.success && parsed.data.taskHash !== approvedTaskHash(task)), task: { id: task.id, title: task.title, leadId: lead.id, leadName: `${lead.firstName} ${lead.lastName}`.trim(), dueDate: task.dueDate.toISOString(), isComplete: task.isComplete }, ...(deadline ? { reviewedDeadline: { previousDueDate: deadline.previousDueDate, dueDate: deadline.dueDate, timeZone: deadline.input.timeZone } } : {}) }
  }) })
 })
 const final = await currentFollowUpAccess(db, organizationId, userId, false)
 if (followUpPageAccessVersion(final.filter, final.taskScope) !== version) throw followUpChanged()
 return result.map(detail => ({ ...detail, canReview: final.canWrite }))
}
export async function readTaskBatch(organizationId: string, userId: string, id: string) {
 z.string().uuid().parse(id)
 return safeFollowUp(() => prisma.$transaction(async db => {
  await lockFollowUpMember(db, organizationId, userId); await currentFollowUpAccess(db, organizationId, userId, false)
  const row = await db.followUpTaskBatch.findFirst({ where: owner(organizationId, userId, id) })
  if (!row) throw followUpUnavailable()
  return (await project(db, organizationId, userId, [row]))[0]
 }, { timeout: 20000 }))
}
const cursorSchema = z.object({ organizationId: z.string(), userId: z.string(), createdAt: z.string().datetime(), id: z.string().uuid() }).strict()
export async function listTaskBatches(organizationId: string, userId: string, cursor?: string) {
 let after: z.infer<typeof cursorSchema> | undefined
 if (cursor !== undefined) {
  try { after = cursorSchema.parse(JSON.parse(Buffer.from(z.string().min(1).max(2048).parse(cursor), 'base64url').toString('utf8'))); if (after.organizationId !== organizationId || after.userId !== userId) throw new Error() }
  catch { throw new AppError('VALIDATION_ERROR', 'Choose a valid history page.', 400) }
 }
 return safeFollowUp(() => prisma.$transaction(async db => {
  await lockFollowUpMember(db, organizationId, userId); await currentFollowUpAccess(db, organizationId, userId, false)
  const rows = await db.followUpTaskBatch.findMany({ where: { organizationId, userId, ...(after ? { OR: [{ createdAt: { lt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), id: { gt: after.id } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 11 })
  const visible = rows.slice(0, 10), details = await project(db, organizationId, userId, visible), last = visible.at(-1)
  return taskBatchList.parse({ items: details.map(detail => { const counts = { confirmed: 0, failed: 0, uncertain: 0, 'not-attempted': 0, unavailable: 0 }; for (const row of detail.items) counts[row.state]++; return { id: detail.id, kind: detail.kind, createdAt: detail.createdAt, counts } }), nextCursor: rows.length > 10 && last ? Buffer.from(JSON.stringify({ organizationId, userId, createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null })
 }, { timeout: 20000 }))
}
