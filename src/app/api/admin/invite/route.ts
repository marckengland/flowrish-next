import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { inviteToOrganization } from '@/server/services/organizations'
import { errorResponse } from '@/lib/errors'

/**
 * POST /api/admin/invite — Invite a user to the organization.
 *
 * Body: { email, roleId, teamId? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const body = await request.json()
    const { email, roleId, teamId } = body

    const invite = await inviteToOrganization(
      email,
      session.organizationId,
      roleId,
      session.dbUser.id,
      teamId,
    )

    return NextResponse.json({ data: invite }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
