import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { pauseEnrollment } from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid enrollment ID'),
})

/**
 * PATCH /api/cadences/enrollments/[id]/pause — Pause an active enrollment.
 *
 * Transitions enrollment from ACTIVE to PAUSED.
 *
 * Validates: Requirements 32.2
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)

    const enrollment = await pauseEnrollment(id, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: enrollment })
  } catch (error) {
    return errorResponse(error)
  }
}
