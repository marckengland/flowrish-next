import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { completeTask, reassignTask } from '@/server/services/tasks'
import { taskUpdateSchema } from '@/lib/validators/tasks'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid task ID'),
})

/**
 * PATCH /api/tasks/[id] — Update or complete a task.
 *
 * Supports two operations:
 * - Complete: { isComplete: true } → marks task complete with timestamp
 * - Reassign: { assigneeId: "new-id" } → reassigns to a different user
 *
 * Validates: Requirements 18.1
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()

    // Validate the update payload
    const validated = taskUpdateSchema.parse(body)

    let task

    // Handle completion
    if (validated.isComplete === true) {
      task = await completeTask(id, session.dbUser.id, session.organizationId)
    }
    // Handle reassignment
    else if (validated.assigneeId) {
      task = await reassignTask(id, validated.assigneeId, session.organizationId)
    }
    // If neither completion nor reassignment, return validation error
    else {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Provide isComplete or assigneeId to update' } },
        { status: 400 },
      )
    }

    return NextResponse.json({ data: task })
  } catch (error) {
    return errorResponse(error)
  }
}
