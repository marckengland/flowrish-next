import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createActivity } from '@/server/services/activities'
import { errorResponse } from '@/lib/errors'

/**
 * POST /api/activities — Log a new activity for a lead.
 *
 * Body: { type, leadId, notes?, callDate?, callDuration?, meetingDate?, attendees? }
 *
 * Validates: Requirements 5.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const activity = await createActivity(body, session.dbUser.id, session.organizationId)

    revalidatePath('/leads')

    return NextResponse.json({ data: activity }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
