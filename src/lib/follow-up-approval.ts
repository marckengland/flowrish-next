import { z } from 'zod'
const id = z.string().min(1).max(128)
const dueDate = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString())
export const approvalInput = z.object({ requestId: z.string().uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), assigneeId: id, title: z.string().trim().min(1).max(200), description: z.string().max(10000), dueDate }).strict()
export const approvalTask = z.object({ id, assigneeId: id, title: z.string().min(1).max(200), description: z.string().max(10000), dueDate }).strict()
export const approvalPreview = z.object({ id, version: z.string().regex(/^[a-f0-9]{64}$/), sourceType: z.enum(['EMAIL', 'CALL']), assigneeId: id, title: z.string().min(1).max(200), description: z.string().max(10000), existingTask: approvalTask.nullable(), leadName: z.string().max(500) }).strict()
const receipt = z.object({ id, requestId: z.string().uuid() })
export const approvalReceipt = z.discriminatedUnion('state', [receipt.extend({ state: z.literal('confirmed'), task: approvalTask }).strict(), receipt.extend({ state: z.enum(['changed', 'not-recorded']), task: z.null() }).strict()])
export type ApprovalInput = z.infer<typeof approvalInput>
export type ApprovalPreview = z.infer<typeof approvalPreview>
export type ApprovalReceipt = z.infer<typeof approvalReceipt>
export type ApprovalTask = z.infer<typeof approvalTask>
export const sameApprovalTask = (task: ApprovalTask, input: Pick<ApprovalInput, 'assigneeId' | 'title' | 'description' | 'dueDate'>) => task.assigneeId === input.assigneeId && task.title === input.title && task.description === input.description && task.dueDate === input.dueDate
