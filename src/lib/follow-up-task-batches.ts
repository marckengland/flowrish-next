import { z } from 'zod'
import { resolveLocalMinute } from './callback-time'
import { taskCompletionInput } from './follow-up-task-completion'
import { taskRescheduleInput } from './follow-up-task-reschedule'
const id = z.string().min(1).max(128)
const kind = z.enum(['COMPLETE', 'RESCHEDULE'])
const complete = z.object({ id, input: taskCompletionInput }).strict()
const reschedule = z.object({ id, input: taskRescheduleInput, previousDueDate: z.string().datetime(), dueDate: z.string().datetime() }).strict()
export const taskBatchRegistration = z.discriminatedUnion('kind', [
 z.object({ id: z.string().uuid(), kind: z.literal('COMPLETE'), items: z.array(complete).min(1).max(20) }).strict(),
 z.object({ id: z.string().uuid(), kind: z.literal('RESCHEDULE'), items: z.array(reschedule).min(1).max(20) }).strict(),
]).superRefine((batch, ctx) => {
 const rows = batch.items
 if ([rows.map(row => row.id), rows.map(row => row.input.taskId), rows.map(row => row.input.requestId)].some(values => new Set(values).size !== values.length)) ctx.addIssue({ code: 'custom', message: 'Use unique follow-ups, tasks and requests.' })
 if (batch.kind === 'RESCHEDULE') for (const row of batch.items) {
  try {
   if (new Date(resolveLocalMinute(row.input.localTime, row.input.timeZone)).toISOString() !== row.dueDate || row.dueDate === row.previousDueDate || row.input.localTime !== batch.items[0].input.localTime || row.input.timeZone !== batch.items[0].input.timeZone) throw new Error()
  } catch { ctx.addIssue({ code: 'custom', message: 'Use one valid reviewed deadline.' }) }
 }
})
export type TaskBatchRegistration = z.infer<typeof taskBatchRegistration>
export const taskBatchAck = z.object({ registration: taskBatchRegistration, createdAt: z.string().datetime() }).strict()
export const taskBatchState = z.enum(['confirmed', 'failed', 'uncertain', 'not-attempted'])
export const taskBatchRow = z.union([
 z.object({ index: z.number().int().min(0).max(19), state: z.literal('unavailable') }).strict(),
 z.object({ index: z.number().int().min(0).max(19), state: taskBatchState, currentChanged: z.boolean(), task: z.object({ id, title: z.string(), leadId: id, leadName: z.string(), dueDate: z.string().datetime(), isComplete: z.boolean() }).strict(), reviewedDeadline: z.object({ previousDueDate: z.string().datetime(), dueDate: z.string().datetime(), timeZone: z.string() }).strict().optional() }).strict(),
])
export const taskBatchDetail = z.object({ id: z.string().uuid(), kind, createdAt: z.string().datetime(), checkedAt: z.string().datetime(), canReview: z.boolean().optional(), items: z.array(taskBatchRow).min(1).max(20) }).strict()
const counts = z.object({ confirmed: z.number().int().min(0), failed: z.number().int().min(0), uncertain: z.number().int().min(0), 'not-attempted': z.number().int().min(0), unavailable: z.number().int().min(0) }).strict()
export const taskBatchList = z.object({ items: z.array(z.object({ id: z.string().uuid(), kind, createdAt: z.string().datetime(), counts }).strict()).max(10), nextCursor: z.string().max(2048).nullable() }).strict()
export type TaskBatchDetail = z.infer<typeof taskBatchDetail>
export type TaskBatchList = z.infer<typeof taskBatchList>
export const TASK_BATCH_HEADER = 'x-flowrish-task-batch'
export const TASK_BATCH_EVENT = 'flowrish:task-batches-changed'
