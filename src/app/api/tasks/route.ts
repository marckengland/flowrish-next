import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTask, getTasks } from '@/server/services/tasks'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/tasks — List tasks with optional filters.
 *
 * Query params: leadId, isComplete, priority, assigneeId
 * Returns tasks sorted by dueDate ascending with overdue highlighting.
 *
 * Validates: Requirements 18.1
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { searchParams } = request.nextUrl

    // Parse optional filters
    const filters = {
      leadId: searchParams.get('leadId') ?? undefined,
      isComplete: searchParams.has('isComplete')
        ? searchParams.get('isComplete') === 'true'
        : undefined,
      priority: (searchParams.get('priority') as 'LOW' | 'MEDIUM' | 'HIGH') ?? undefined,
      assigneeId: searchParams.get('assigneeId') ?? undefined,
    }

    const tasks = await getTasks(session.dbUser.id, filters, session.organizationId)

    return NextResponse.json({ data: tasks })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/tasks — Create a new task.
 *
 * Body: { title, dueDate, leadId, assigneeId, description?, priority? }
 *
 * Validates: Requirements 18.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const task = await createTask(body, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: task }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
