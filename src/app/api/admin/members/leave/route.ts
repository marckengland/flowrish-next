import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * POST /api/admin/members/leave — Leave the current organization.
 *
 * Removes the current user's OrganizationMember and TeamMember records.
 * Cannot leave if you're the last OWNER (transfer ownership first).
 */
export async function POST() {
  try {
    const session = await requireSession()
    const userId = session.dbUser.id
    const orgId = session.organizationId

    // Check if user is the last OWNER
    const ownerRole = await prisma.role.findFirst({
      where: { organizationId: orgId, name: 'OWNER' },
    })
    if (ownerRole) {
      const userIsOwner = await prisma.teamMember.findFirst({
        where: {
          userId,
          roleId: ownerRole.id,
          team: { organizationId: orgId },
        },
      })
      if (userIsOwner) {
        const ownerCount = await prisma.teamMember.count({
          where: {
            roleId: ownerRole.id,
            team: { organizationId: orgId },
          },
        })
        if (ownerCount <= 1) {
          throw new AppError(
            'FORBIDDEN',
            'Cannot leave as the last owner. Transfer ownership to another member first.',
            403,
          )
        }
      }
    }

    // Remove all team memberships in this org
    const orgTeams = await prisma.team.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    })
    await prisma.teamMember.deleteMany({
      where: {
        userId,
        teamId: { in: orgTeams.map((t) => t.id) },
      },
    })

    // Remove organization membership
    await prisma.organizationMember.deleteMany({
      where: { userId, organizationId: orgId },
    })

    return NextResponse.json({ data: { left: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
