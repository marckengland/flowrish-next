import { z } from 'zod'
import { followUpFilterSchema } from './follow-up-filters'

export const SAVED_FOLLOW_UP_VIEW_LIMIT = 20
const name = z.string().trim().regex(/^[^\u0000-\u001f\u007f]+$/, 'Use a name without control characters.').transform(value => value.replace(/\s+/g, ' ')).pipe(z.string().min(1).max(80))
export const savedFollowUpViewIdSchema = z.string().uuid()
export const savedFollowUpSettingsSchema = z.object({ status: z.enum(['PENDING', 'APPROVED', 'DISMISSED', 'SNOOZED']), filters: followUpFilterSchema }).strict().refine(value => !value.filters.dueOnly || value.status === 'PENDING', 'Due reminders belong in Pending.').refine(value => !value.filters.taskProgress || value.status === 'APPROVED', 'Task progress belongs in Approved.').refine(value => !value.filters.taskOrder || value.status === 'APPROVED', 'Task ordering belongs in Approved.')
export const savedFollowUpViewCreateSchema = z.object({ id: savedFollowUpViewIdSchema, name, settings: savedFollowUpSettingsSchema }).strict()
export const savedFollowUpViewDeleteSchema = z.object({ expectedRevision: z.number().int().positive().max(2_000_000_000) }).strict()
export const savedFollowUpViewUpdateSchema = savedFollowUpViewDeleteSchema.extend({ name: name.optional(), settings: savedFollowUpSettingsSchema.optional() }).strict().refine(value => value.name !== undefined || value.settings !== undefined, 'Choose a name or settings to update.')
export const savedFollowUpViewSchema = savedFollowUpViewCreateSchema.extend({ revision: z.number().int().positive(), updatedAt: z.string().datetime() }).strict()
export type SavedFollowUpView = z.infer<typeof savedFollowUpViewSchema>
export type SavedFollowUpSettings = z.infer<typeof savedFollowUpSettingsSchema>
