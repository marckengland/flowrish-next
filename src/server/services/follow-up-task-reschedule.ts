import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Task } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { resolveLocalMinute } from '@/lib/callback-time'
import { taskRescheduleInput, taskRescheduleTarget, taskReschedulePreview, taskRescheduleReceipt } from '@/lib/follow-up-task-reschedule'
import { followUpChanged, requireFollowUpWrites, safeFollowUp } from './follow-up-access'
import { lockApprovedTask, approvedTaskVersion, recheckApprovedTask, approvedTaskHash } from './follow-up-task-review'
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const auditWhere = (organizationId: string, userId: string, id: string, requestId: string) => ({ id: requestId, organizationId, userId, entityType: 'FollowUpSuggestion', entityId: id, action: 'UPDATE' as const })
const proofSchema = z.object({ taskReschedule: z.object({ inputHash: z.string(), taskHash: z.string(), taskId: z.string(), previousDueDate: z.string().datetime(), dueDate: z.string().datetime() }).strict() })
function target(raw: unknown) {
 const input = taskRescheduleTarget.parse(raw)
 try { return { ...input, dueDate: new Date(resolveLocalMinute(input.localTime, input.timeZone)).toISOString() } }
 catch (error) { throw new AppError('VALIDATION_ERROR', error instanceof RangeError ? error.message : 'Choose a valid deadline and timezone.', 400) }
}
function validateDeadline(task: Task, dueDate: string) {
 if (task.isComplete) throw followUpChanged()
 if (new Date(dueDate).getTime() <= Date.now() || task.dueDate.toISOString() === dueDate) throw new AppError('VALIDATION_ERROR', 'Choose a future deadline different from the current deadline.', 400)
}
const reviewVersion = (snapshot: Parameters<typeof approvedTaskVersion>[0], chosen: ReturnType<typeof target>) => digest([approvedTaskVersion(snapshot), chosen])
function receipt(id: string, requestId: string, task: Task, changes?: unknown) {
 const proof = proofSchema.safeParse(changes)
 const confirmed = proof.success && proof.data.taskReschedule.taskId === task.id && proof.data.taskReschedule.taskHash === approvedTaskHash(task) && !task.isComplete && proof.data.taskReschedule.dueDate === task.dueDate.toISOString()
 return taskRescheduleReceipt.parse({ id, requestId, state: changes === undefined ? 'not-recorded' : confirmed ? 'confirmed' : 'changed', task: confirmed ? { id: task.id, previousDueDate: proof.data.taskReschedule.previousDueDate, dueDate: task.dueDate.toISOString(), checkedAt: new Date().toISOString() } : null })
}
export async function previewTaskReschedule(organizationId: string, userId: string, id: string, raw: unknown) {
 const chosen = target(raw)
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await lockApprovedTask(db, organizationId, userId, id, false), { task, lead } = snapshot
  validateDeadline(task, chosen.dueDate)
  await recheckApprovedTask(db, organizationId, userId, snapshot)
  return taskReschedulePreview.parse({ id, version: reviewVersion(snapshot, chosen), localTime: chosen.localTime, timeZone: chosen.timeZone, newDueDate: chosen.dueDate, leadName: (lead.firstName + ' ' + lead.lastName).trim(), task: { id: task.id, title: task.title, description: task.description ?? '', assigneeId: task.assigneeId, assigneeName: task.assignee.name, dueDate: task.dueDate.toISOString() } })
 }, { timeout: 20000 }))
}
export async function readTaskReschedule(organizationId: string, userId: string, id: string, requestId: string) {
 z.string().uuid().parse(requestId)
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await lockApprovedTask(db, organizationId, userId, id, false)
  const audit = await db.auditEntry.findFirst({ where: auditWhere(organizationId, userId, id, requestId), select: { changes: true } })
  return receipt(id, requestId, await recheckApprovedTask(db, organizationId, userId, snapshot), audit?.changes)
 }, { timeout: 20000 }))
}
export async function rescheduleFollowUpTask(organizationId: string, userId: string, id: string, raw: unknown) {
 const input = taskRescheduleInput.parse(raw), chosen = target({ localTime: input.localTime, timeZone: input.timeZone })
 requireFollowUpWrites()
 return safeFollowUp(() => prisma.$transaction(async db => {
  const snapshot = await lockApprovedTask(db, organizationId, userId, id, true)
  if (snapshot.task.id !== input.taskId) throw followUpChanged()
  const audit = await db.auditEntry.findFirst({ where: auditWhere(organizationId, userId, id, input.requestId), select: { changes: true } })
  if (audit) {
   const proof = proofSchema.safeParse(audit.changes), result = receipt(id, input.requestId, await recheckApprovedTask(db, organizationId, userId, snapshot), audit.changes)
   if (!proof.success || proof.data.taskReschedule.inputHash !== digest(input) || result.state !== 'confirmed') throw followUpChanged()
   return result
  }
  if (snapshot.task.isComplete || reviewVersion(snapshot, chosen) !== input.expectedVersion) throw followUpChanged()
  validateDeadline(snapshot.task, chosen.dueDate)
  await recheckApprovedTask(db, organizationId, userId, snapshot)
  const previousDueDate = snapshot.task.dueDate.toISOString(), now = new Date()
  const task = await db.task.update({ where: { id: input.taskId, organizationId, leadId: snapshot.row.leadId, assigneeId: snapshot.task.assigneeId, isComplete: false, updatedAt: snapshot.task.updatedAt }, data: { dueDate: new Date(chosen.dueDate) } })
  await db.activity.create({ data: { organizationId, leadId: task.leadId, createdById: userId, type: 'NOTE', notes: 'Task rescheduled: ' + task.title + '. ' + previousDueDate + ' → ' + chosen.dueDate + ' (' + chosen.localTime + ' ' + chosen.timeZone + ')' } })
  await db.lead.update({ where: { id: task.leadId, organizationId }, data: { lastActivityAt: now } })
  const changes = { taskReschedule: { inputHash: digest(input), taskHash: approvedTaskHash(task), taskId: task.id, previousDueDate, dueDate: chosen.dueDate } }
  await db.auditEntry.create({ data: { id: input.requestId, organizationId, userId, entityType: 'FollowUpSuggestion', entityId: id, action: 'UPDATE', changes } })
  const result = receipt(id, input.requestId, await recheckApprovedTask(db, organizationId, userId, snapshot), changes)
  if (result.state !== 'confirmed') throw followUpChanged()
  return result
 }, { timeout: 20000 }))
}
