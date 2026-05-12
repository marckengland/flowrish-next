'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  createTask as createTaskService,
  completeTask as completeTaskService,
  reassignTask,
} from '@/server/services/tasks'
import { createTenantPrisma } from '@/server/db/middleware'
import { ZodError } from 'zod'

/**
 * Server Actions for task management mutations.
 *
 * Each action:
 * 1. Authenticates via requireSession()
 * 2. Authorizes via requirePermission('leads:write')
 * 3. Parses formData / arguments
 * 4. Calls the service function
 * 5. Logs an audit entry (async, non-blocking)
 * 6. Calls revalidatePath('/tasks') to refresh cached data
 * 7. Returns { data } on success or { error } on failure
 *
 * Validates: Requirements 18.1, 18.3
 */

/**
 * Creates a new task from form data.
 *
 * Required fields: title, dueDate, leadId, assigneeId
 * Optional fields: priority, description
 */
export async function createTask(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  // Parse formData into a plain object
  const data = formDataToTaskObject(formData)

  try {
    const task = await createTaskService(data, session.dbUser.id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'CREATE',
        entityType: 'Task',
        entityId: task.id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (createTask):', err)
    })

    revalidatePath('/tasks')
    return { data: task }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to create task. Please try again.' }
  }
}

/**
 * Marks a task as complete by ID.
 *
 * Sets isComplete=true and records completedAt timestamp.
 * Also logs an activity on the associated lead.
 */
export async function completeTask(id: string) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  if (!id) {
    return { error: 'Task ID is required' }
  }

  try {
    const task = await completeTaskService(id, session.dbUser.id, session.organizationId)

    // Audit log: async, non-blocking
    const db = createTenantPrisma(session.organizationId)
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Task',
        entityId: id,
        metadata: JSON.stringify({ action: 'complete' }),
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (completeTask):', err)
    })

    revalidatePath('/tasks')
    return { data: task }
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to complete task. Please try again.' }
  }
}

/**
 * Updates an existing task from form data.
 *
 * Requires a task `id` field in the form data.
 * If `assigneeId` is changed, calls reassignTask service.
 * All other fields are optional — only provided fields are updated.
 */
export async function updateTask(formData: FormData) {
  const session = await requireSession()
  requirePermission(session.dbUser, 'leads:write')

  const id = formData.get('id') as string | null
  if (!id) {
    return { error: 'Task ID is required' }
  }

  // Parse formData into a plain object, excluding the id field
  const data = formDataToTaskObject(formData)
  delete data.id

  try {
    const db = createTenantPrisma(session.organizationId)

    // If assigneeId is being changed, use the reassignTask service
    if (data.assigneeId) {
      await reassignTask(id, data.assigneeId as string, session.organizationId)
      delete data.assigneeId
    }

    // Update remaining fields if any
    let updatedTask
    const updateData: Record<string, unknown> = {}
    if (data.title !== undefined) updateData.title = data.title as string
    if (data.description !== undefined) updateData.description = data.description as string
    if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate as string)
    if (data.priority !== undefined) updateData.priority = data.priority as string

    if (Object.keys(updateData).length > 0) {
      updatedTask = await db.task.update({
        where: { id },
        data: updateData,
      })
    } else {
      updatedTask = await db.task.findFirst({ where: { id } })
    }

    // Audit log: async, non-blocking
    db.auditEntry.create({
      data: {
        userId: session.dbUser.id,
        action: 'UPDATE',
        entityType: 'Task',
        entityId: id,
      } as any,
    }).catch((err) => {
      console.error('Audit log failed (updateTask):', err)
    })

    revalidatePath('/tasks')
    return { data: updatedTask }
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return { error: err.errors[0]?.message ?? 'Validation failed' }
    }
    if (err && typeof err === 'object' && 'statusCode' in err) {
      const appErr = err as { message: string; statusCode: number }
      return { error: appErr.message }
    }
    return { error: 'Failed to update task. Please try again.' }
  }
}

/**
 * Converts FormData into a plain object suitable for task operations.
 *
 * - Skips empty string values (treats them as not provided)
 * - Preserves string values for Zod coercion (dueDate handled by z.coerce.date())
 */
function formDataToTaskObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      // Skip empty strings for optional fields
      if (value === '') continue
      obj[key] = value
    }
  }

  return obj
}
