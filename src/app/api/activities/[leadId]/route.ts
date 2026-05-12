import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getActivitiesByLead } from '@/server/services/activities'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
})

/**
 * GET /api/activities/[leadId] — Get all activities for a lead.
 *
 * Returns activities sorted by createdAt descending (newest first).
 *
 * Validates: Requirements 5.1
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { leadId } = paramsSchema.parse(await params)

    const activities = await getActivitiesByLead(leadId, session.organizationId)

    return NextResponse.json({ data: activities })
  } catch (error) {
    return errorResponse(error)
  }
}
