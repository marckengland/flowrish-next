import { z } from 'zod'

const id = z.string().min(1).max(128)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
export const taskCompletionInput = z.object({ requestId: z.string().uuid(), expectedVersion: hash, taskId: id }).strict()
export const taskCompletionPreview = z.object({
 id, version: hash, leadName: z.string(),
 task: z.object({ id, title: z.string(), description: z.string(), assigneeId: id, assigneeName: z.string(), dueDate: z.string().datetime() }).strict(),
}).strict()
export const taskCompletionReceipt = z.discriminatedUnion('state', [
 z.object({ id, requestId: z.string().uuid(), state: z.literal('confirmed'), task: z.object({ id, dueDate: z.string().datetime(), completedAt: z.string().datetime(), checkedAt: z.string().datetime() }).strict() }).strict(),
 z.object({ id, requestId: z.string().uuid(), state: z.enum(['changed', 'not-recorded']), task: z.null() }).strict(),
])
export type TaskCompletionInput = z.infer<typeof taskCompletionInput>
export type TaskCompletionPreview = z.infer<typeof taskCompletionPreview>
export type TaskCompletionReceipt = z.infer<typeof taskCompletionReceipt>
