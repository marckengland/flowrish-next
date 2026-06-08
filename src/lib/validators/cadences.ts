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
 *
 * Required fields: actionType, stepOrder, delayHours.
 *
 * The step body is shaped by `actionType`:
 * - EMAIL → `subject` + `body` are used; `taskTitle`/`taskDescription` are ignored.
 * - CALL / LINKEDIN / MANUAL_TASK → `taskTitle` + `taskDescription` are used.
 *
 * `instructions` is kept as a backward-compatible alias that maps to
 * `taskTitle` when `taskTitle` is not provided. It exists so the simple
 * "instructions" textarea in the inline add form keeps working alongside
 * the richer step editor that distinguishes title and description.
 */
export const stepCreateSchema = z.object({
  actionType: stepActionTypeEnum,
  stepOrder: z.coerce.number().int().min(1, 'Step order must be at least 1'),
  delayHours: z.coerce.number().int().min(0, 'Delay hours must be non-negative'),
  subject: nullableSanitizedString,
  body: nullableSanitizedString,
  instructions: nullableSanitizedString,
  taskTitle: nullableSanitizedString,
  taskDescription: nullableSanitizedString,
  /**
   * EMAIL step only. When true, the runner ignores the enrollment's
   * existing Gmail thread and starts a new conversation instead of
   * replying. Useful for breakup or re-engagement sequences. Coerced
   * from the string `'true'` / `'on'` posted by HTML form fields.
   */
  startNewThread: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === 'on'),
})

export type StepCreateInput = z.infer<typeof stepCreateSchema>

/**
 * Schema for updating a cadence step. All fields are optional —
 * callers may patch any subset.
 *
 * `stepOrder` is intentionally excluded: ordering is managed exclusively
 * by `reorderSteps` (Requirement 6.4) so that orders stay contiguous.
 */
export const stepUpdateSchema = z
  .object({
    actionType: stepActionTypeEnum.optional(),
    delayHours: z.coerce
      .number()
      .int()
      .min(0, 'Delay hours must be non-negative')
      .optional(),
    subject: nullableSanitizedString,
    body: nullableSanitizedString,
    taskTitle: nullableSanitizedString,
    taskDescription: nullableSanitizedString,
    /** See `stepCreateSchema.startNewThread` — same semantics. */
    startNewThread: z.boolean().optional(),
  })
  .refine(
    (val) =>
      val.actionType !== undefined
      || val.delayHours !== undefined
      || val.subject !== undefined
      || val.body !== undefined
      || val.taskTitle !== undefined
      || val.taskDescription !== undefined
      || val.startNewThread !== undefined,
    { message: 'At least one field must be provided to update' },
  )

export type StepUpdateInput = z.infer<typeof stepUpdateSchema>

/**
 * Schema for enrolling a lead in a cadence.
 * Required fields: leadId
 */
export const enrollSchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
})

export type EnrollInput = z.infer<typeof enrollSchema>
