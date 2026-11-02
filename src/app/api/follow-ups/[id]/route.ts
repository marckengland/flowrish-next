import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { listFollowUps, reviewFollowUp } from '@/server/services/follow-ups'
import { errorResponse } from '@/lib/errors'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    requirePermission(session.dbUser, 'leads:write')
    const { id } = await context.params
    const result = await reviewFollowUp(session.organizationId, session.dbUser.id, id, await request.json())
    const rows = await listFollowUps(session.organizationId, session.dbUser.id, result.status)
    return NextResponse.json({ data: rows.find((row) => row.id === id) ?? result })
  } catch (error) { return errorResponse(error) }
}
