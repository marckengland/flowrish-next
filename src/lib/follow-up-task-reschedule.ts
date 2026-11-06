import { z } from 'zod'
import { taskCompletionPreview } from './follow-up-task-completion'
const id = z.string().min(1).max(128)
export const taskRescheduleTarget = z.object({ localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), timeZone: z.string().min(1).max(100) }).strict()
export const taskRescheduleInput = taskRescheduleTarget.extend({ requestId: z.string().uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), taskId: id }).strict()
export const taskReschedulePreview = taskCompletionPreview.extend({ localTime: z.string(), timeZone: z.string(), newDueDate: z.string().datetime() }).strict()
export const taskRescheduleReceipt = z.discriminatedUnion('state', [
 z.object({ id, requestId: z.string().uuid(), state: z.literal('confirmed'), task: z.object({ id, previousDueDate: z.string().datetime(), dueDate: z.string().datetime(), checkedAt: z.string().datetime() }).strict() }).strict(),
 z.object({ id, requestId: z.string().uuid(), state: z.enum(['changed', 'not-recorded']), task: z.null() }).strict(),
])
export type TaskRescheduleInput = z.infer<typeof taskRescheduleInput>
export type TaskReschedulePreview = z.infer<typeof taskReschedulePreview>
export type TaskRescheduleReceipt = z.infer<typeof taskRescheduleReceipt>
