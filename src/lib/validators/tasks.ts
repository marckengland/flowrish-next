import { z } from 'zod'
import { sanitizedString, nullableSanitizedString } from './common'

/**
 * Task priority enum values.
 */
export const taskPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH'])

/**
 * Schema for creating a new task.
 * Required fields: title, dueDate, leadId, assigneeId
 */
export const taskCreateSchema = z.object({
  title: sanitizedString.pipe(z.string().min(1, 'Title is required').max(500)),
  description: nullableSanitizedString,
  dueDate: z.coerce.date({ required_error: 'Due date is required' }),
  priority: taskPriorityEnum.default('MEDIUM'),
  leadId: z.string().uuid('Invalid lead ID'),
  assigneeId: z.string().uuid('Invalid assignee ID'),
})

export type TaskCreateInput = z.infer<typeof taskCreateSchema>

/**
 * Schema for updating an existing task.
 * All fields are optional — only provided fields are updated.
 */
export const taskUpdateSchema = z.object({
  title: sanitizedString.pipe(z.string().min(1, 'Title is required').max(500)).optional(),
  description: nullableSanitizedString,
  dueDate: z.coerce.date().optional(),
  priority: taskPriorityEnum.optional(),
  assigneeId: z.string().uuid('Invalid assignee ID').optional(),
  isComplete: z.boolean().optional(),
})

export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>
