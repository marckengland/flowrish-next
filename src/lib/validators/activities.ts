import { z } from 'zod'
import { sanitizedString, nullableSanitizedString } from './common'

/**
 * Activity type enum values.
 */
export const activityTypeEnum = z.enum([
  'CALL',
  'MEETING',
  'NOTE',
  'EMAIL',
  'FILE_ATTACHMENT',
])

/**
 * Schema for creating a new activity.
 * Required fields: type, leadId
 * Type-specific fields are validated conditionally.
 */
export const activityCreateSchema = z
  .object({
    type: activityTypeEnum,
    leadId: z.string().uuid('Invalid lead ID'),
    notes: nullableSanitizedString,
    // CALL-specific fields
    callDate: z.coerce.date().optional(),
    callDuration: z.coerce.number().int().min(0).optional(),
    // MEETING-specific fields
    meetingDate: z.coerce.date().optional(),
    attendees: z.array(sanitizedString).optional(),
  })
  .refine(
    data => {
      if (data.type === 'CALL') {
        return data.callDate !== undefined
      }
      return true
    },
    { message: 'callDate is required for CALL activities', path: ['callDate'] }
  )
  .refine(
    data => {
      if (data.type === 'MEETING') {
        return data.meetingDate !== undefined
      }
      return true
    },
    { message: 'meetingDate is required for MEETING activities', path: ['meetingDate'] }
  )

export type ActivityCreateInput = z.infer<typeof activityCreateSchema>
