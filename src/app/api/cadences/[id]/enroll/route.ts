import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { requireEntitlement } from '@/server/auth/entitlements'
import { enrollLead } from '@/server/services/cadences'
import { enrollSchema } from '@/lib/validators/cadences'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
})

/**
 * POST /api/cadences/[id]/enroll — Enroll a lead in a cadence.
 *
 * Body: { leadId }
 *
 * Validates: Requirements 6.5, 6.6
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')
    await requireEntitlement(session.organizationId, 'cadences')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { leadId } = enrollSchema.parse(body)

    const enrollment = await enrollLead(id, leadId, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: enrollment }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
