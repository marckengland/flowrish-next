import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { resumeEnrollment } from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid enrollment ID'),
})

/**
 * PATCH /api/cadences/enrollments/[id]/resume — Resume a paused enrollment.
 *
 * Transitions enrollment from PAUSED to ACTIVE.
 *
 * Validates: Requirements 32.3
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)

    const enrollment = await resumeEnrollment(id, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: enrollment })
  } catch (error) {
    return errorResponse(error)
  }
}
