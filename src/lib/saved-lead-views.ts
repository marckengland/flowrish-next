import { z } from 'zod'
import { leadStatusEnum, leadTierEnum } from './validators/leads'

export const SAVED_LEAD_VIEW_LIMIT = 20
export const SAVED_VIEW_USER_HEADER = 'x-flowrish-view-user'
export const savedLeadFiltersSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  stageId: z.string().uuid().optional(),
  pipelineId: z.string().uuid().optional(),
  assignedUserId: z.string().uuid().optional(),
  leadStatus: leadStatusEnum.optional(),
  tier: leadTierEnum.optional(),
}).strict()
const nameSchema = z.string().trim().regex(/^[^\u0000-\u001f\u007f]+$/, 'Use a name without control characters.').transform(value => value.replace(/\s+/g, ' ')).pipe(z.string().min(1).max(80))
export const savedLeadViewIdSchema = z.string().uuid()
export const savedLeadViewCreateSchema = z.object({ id: savedLeadViewIdSchema, name: nameSchema, filters: savedLeadFiltersSchema }).strict()
export const savedLeadViewDeleteSchema = z.object({ expectedRevision: z.number().int().positive().max(2_000_000_000) }).strict()
export const savedLeadViewUpdateSchema = savedLeadViewDeleteSchema.extend({ name: nameSchema.optional(), filters: savedLeadFiltersSchema.optional() }).strict().refine(value => value.name !== undefined || value.filters !== undefined, 'Choose a name or filters to update.')
export const savedLeadViewSchema = z.object({ id: savedLeadViewIdSchema, name: nameSchema, filters: savedLeadFiltersSchema, revision: z.number().int().positive(), updatedAt: z.string().datetime() }).strict()
export type SavedLeadView = z.infer<typeof savedLeadViewSchema>
export type SavedLeadFilters = z.infer<typeof savedLeadFiltersSchema>

export function unavailableViewFilters(filters: SavedLeadFilters, options: { stages: readonly { value: string }[]; assignees: readonly { value: string }[]; pipelineId?: string }) {
  const missing: string[] = []
  if (filters.stageId && !options.stages.some(stage => stage.value === filters.stageId)) missing.push('stage')
  if (filters.assignedUserId && !options.assignees.some(user => user.value === filters.assignedUserId)) missing.push('assignee')
  if (filters.pipelineId && filters.pipelineId !== options.pipelineId) missing.push('pipeline')
  return missing
}
