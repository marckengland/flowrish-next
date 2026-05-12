import { z } from 'zod'
import { sanitizedString, nullableSanitizedString } from './common'

/**
 * Cadence step action type enum values.
 */
export const stepActionTypeEnum = z.enum(['EMAIL', 'CALL', 'LINKEDIN', 'MANUAL_TASK'])

/**
 * Schema for creating a new cadence.
 * Required fields: name
 */
export const cadenceCreateSchema = z.object({
  name: sanitizedString.pipe(z.string().min(1, 'Cadence name is required').max(200)),
  description: nullableSanitizedString,
})

export type CadenceCreateInput = z.infer<typeof cadenceCreateSchema>

/**
 * Schema for creating a cadence step.
 * Required fields: actionType, stepOrder, delayHours
 */
export const stepCreateSchema = z.object({
  actionType: stepActionTypeEnum,
  stepOrder: z.coerce.number().int().min(1, 'Step order must be at least 1'),
  delayHours: z.coerce.number().int().min(0, 'Delay hours must be non-negative'),
  subject: nullableSanitizedString,
  body: nullableSanitizedString,
  instructions: nullableSanitizedString,
})

export type StepCreateInput = z.infer<typeof stepCreateSchema>

/**
 * Schema for enrolling a lead in a cadence.
 * Required fields: leadId
 */
export const enrollSchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
})

export type EnrollInput = z.infer<typeof enrollSchema>
