import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { exitEnrollment } from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid enrollment ID'),
})

const exitSchema = z.object({
  reason: z.enum([
    'reply_received',
    'meeting_booked',
    'cadence_archived',
    'lead_converted',
    'manual',
  ], { message: 'Invalid exit reason' }),
})

/**
 * PATCH /api/cadences/enrollments/[id]/exit — Exit an enrollment.
 *
 * Body: { reason: ExitReason }
 *
 * Transitions enrollment from ACTIVE or PAUSED to EXITED with the given reason.
 *
 * Validates: Requirements 6.8, 6.9
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { reason } = exitSchema.parse(body)

    const enrollment = await exitEnrollment(id, reason, session.organizationId)

    return NextResponse.json({ data: enrollment })
  } catch (error) {
    return errorResponse(error)
  }
}
