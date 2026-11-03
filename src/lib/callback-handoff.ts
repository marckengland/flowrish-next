import { z } from 'zod'
import { websiteCallbackRecordSchema } from './website-receptionist'
import { callbackCalendarSchema, preferredTimeSchema } from './callback-time'

const id = z.string().uuid()
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\0\r\n]/.test(value), 'Use a single line of text.')
export const handoffDraftSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  target: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('lead'), leadId: id }).strict(),
    z.object({ mode: z.literal('new'), firstName: text(120), lastName: text(120), stageId: id, contactId: id.nullable() }).strict(),
  ]),
  assigneeId: id, dueDate: z.string().datetime({ offset: true }), acknowledgeDuplicate: z.boolean(),
}).strict()
export const handoffCommitSchema = z.object({ draft: handoffDraftSchema, previewVersion: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict()
export const handoffReceiptSchema = z.object({ callbackId: id, leadId: id, taskId: id, createdAt: z.string().datetime(), leadAvailable: z.boolean(), taskAvailable: z.boolean(), preferredTime: preferredTimeSchema.optional() }).strict()
const choice = z.object({ id, label: text(512) }).strict()
export const handoffOptionsSchema = z.object({
  callback: websiteCallbackRecordSchema.nullable(), receipt: handoffReceiptSchema.nullable(),
  leads: z.array(choice).max(20),
  contacts: z.array(choice.extend({ leadIds: z.array(id).max(20) }).strict()).max(20),
  members: z.array(choice).max(200), stages: z.array(choice).max(200),
  matchesTruncated: z.boolean(), choicesTruncated: z.boolean(), callbackHours: callbackCalendarSchema.optional(),
}).strict()
export const handoffPreviewSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/), draft: handoffDraftSchema,
  targetLabel: text(512), contactLabel: text(512).nullable(), assigneeName: text(512),
  taskTitle: text(500), taskDescription: z.string().min(1).max(5000), preferredTime: preferredTimeSchema.optional(), confirmedTime: preferredTimeSchema.optional(),
}).strict()
export type HandoffDraft = z.infer<typeof handoffDraftSchema>
export type HandoffOptions = z.infer<typeof handoffOptionsSchema>
export type HandoffPreview = z.infer<typeof handoffPreviewSchema>
export type HandoffReceipt = z.infer<typeof handoffReceiptSchema>
