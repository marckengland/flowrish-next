import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getTeamHierarchy } from '@/server/services/teams'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/teams/hierarchy — Get the full team hierarchy tree.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const hierarchy = await getTeamHierarchy(session.organizationId)

    return NextResponse.json({ data: hierarchy })
  } catch (error) {
    return errorResponse(error)
  }
}
