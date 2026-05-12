import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { activateCadence } from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
})

/**
 * PATCH /api/cadences/[id]/activate — Activate a cadence.
 *
 * Transitions cadence from DRAFT to ACTIVE.
 * Requires at least one step to exist.
 *
 * Validates: Requirements 6.2
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)

    const cadence = await activateCadence(id, session.organizationId)

    return NextResponse.json({ data: cadence })
  } catch (error) {
    return errorResponse(error)
  }
}
