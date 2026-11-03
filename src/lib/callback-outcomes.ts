import { z } from 'zod'
import { websiteCallbackRecordSchema } from './website-receptionist'
import { callbackCalendarSchema, preferredTimeSchema } from './callback-time'
const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/)
const name = z.string().min(1).max(512)
export const callbackOutcomeEnum = z.enum(['reached', 'no_answer', 'retry'])
export const callbackOutcomeActionSchema = z.enum(['record', 'reschedule', 'close'])
export const callbackOutcomeDraftSchema = z.object({
  outcome: callbackOutcomeEnum, action: callbackOutcomeActionSchema,
  notes: z.string().trim().max(2000).refine(value => !value.includes('\0'), 'Unsupported text.'),
  assigneeId: id.nullable(), dueDate: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((data, ctx) => {
  if (data.action === 'reschedule' ? !data.assigneeId || !data.dueDate : data.assigneeId !== null || data.dueDate !== null) ctx.addIssue({ code: 'custom', message: 'Choose an owner and deadline only when rescheduling.' })
})
export const callbackOutcomePreviewInputSchema = z.object({ draft: callbackOutcomeDraftSchema, expectedVersion: hash }).strict()
export const callbackOutcomeCommitSchema = callbackOutcomePreviewInputSchema.extend({ previewVersion: hash, requestId: id, confirmed: z.literal(true) }).strict()
export const callbackOutcomeAckSchema = z.object({ recorded: z.literal(true), callbackId: id, requestId: id, action: callbackOutcomeActionSchema }).strict()
export const callbackOutcomeEventSchema = z.object({ id, sequence: z.number().int().positive(), outcome: callbackOutcomeEnum, action: callbackOutcomeActionSchema, notes: z.string().max(2000), createdAt: z.string().datetime(), createdByName: name, assigneeName: name.nullable(), dueDate: z.string().datetime().nullable() }).strict()
export const callbackOutcomeDetailSchema = z.object({
  callbackId: id, taskId: id, version: hash, preferredTime: preferredTimeSchema.optional(), callbackHours: callbackCalendarSchema.optional(), source: websiteCallbackRecordSchema.nullable(), closed: z.boolean(), canEdit: z.boolean(),
  task: z.object({ id, title: z.string().max(500), dueDate: z.string().datetime(), assigneeId: id, assigneeName: name, isComplete: z.boolean() }).strict().nullable(),
  leadAvailable: z.boolean(), members: z.array(z.object({ id, label: name }).strict()).max(200), membersTruncated: z.boolean(),
  history: z.array(callbackOutcomeEventSchema).max(20), hasMore: z.boolean(), beforeNext: z.number().int().positive().nullable(),
}).strict()
export const callbackOutcomePreviewSchema = callbackOutcomePreviewInputSchema.extend({ callbackId: id, version: hash, taskTitle: z.string().max(500), taskChange: z.string().max(600), sourceChange: z.string().max(600), nextOwner: name.nullable(), nextDueDate: z.string().datetime().nullable(), reopensTask: z.boolean(), confirmedTime: preferredTimeSchema.optional() }).strict()
export const callbackOutcomeHistoryQuerySchema = z.object({ before: z.coerce.number().int().positive().max(2147483647).optional() }).strict()
export const callbackOutcomeQueueQuerySchema = z.object({ filter: z.enum(['overdue', 'open', 'closed', 'all']).default('overdue'), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict()
export const callbackOutcomeQueueSchema = z.object({ rows: z.array(z.object({ callbackId: id, taskId: id, title: z.string().max(500), assigneeName: name, dueDate: z.string().datetime(), isComplete: z.boolean(), closed: z.boolean(), latestOutcome: callbackOutcomeEnum.nullable() }).strict()).max(20), page: z.number().int().positive(), hasMore: z.boolean() }).strict()
export type CallbackOutcomeDraft = z.infer<typeof callbackOutcomeDraftSchema>
export type CallbackOutcomeDetail = z.infer<typeof callbackOutcomeDetailSchema>
export type CallbackOutcomePreview = z.infer<typeof callbackOutcomePreviewSchema>
export type CallbackOutcomeQueue = z.infer<typeof callbackOutcomeQueueSchema>
export type CallbackOutcomeAction = z.infer<typeof callbackOutcomeActionSchema>
