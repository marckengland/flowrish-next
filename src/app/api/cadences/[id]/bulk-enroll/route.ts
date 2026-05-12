import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { bulkEnroll } from '@/server/services/cadences'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
})

const bulkEnrollSchema = z.object({
  leadIds: z.array(z.string().uuid('Invalid lead ID')).min(1, 'At least one lead ID is required'),
})

/**
 * POST /api/cadences/[id]/bulk-enroll — Bulk enroll leads in a cadence.
 *
 * Body: { leadIds: string[] }
 *
 * Returns enrolled and skipped counts. Skips leads that already have
 * an active enrollment (does not throw).
 *
 * Validates: Requirements 6.5, 6.6, 32.5
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { leadIds } = bulkEnrollSchema.parse(body)

    const result = await bulkEnroll(id, leadIds, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
