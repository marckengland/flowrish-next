import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/teams — List all teams in the organization with member count.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const teams = await prisma.team.findMany({
      where: { organizationId: session.organizationId },
      include: {
        _count: { select: { members: true } },
        parentTeam: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ data: teams })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/admin/teams — Create a new team in the organization.
 *
 * Body: { name, parentTeamId? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const body = await request.json()
    const { name, parentTeamId } = body

    const team = await prisma.team.create({
      data: {
        name,
        organizationId: session.organizationId,
        parentTeamId: parentTeamId ?? null,
      },
      include: {
        _count: { select: { members: true } },
        parentTeam: { select: { id: true, name: true } },
      },
    })

    return NextResponse.json({ data: team }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
