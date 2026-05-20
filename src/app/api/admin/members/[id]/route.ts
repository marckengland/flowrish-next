import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * DELETE /api/admin/members/[id] — Remove a member from the organization.
 *
 * Removes the user's OrganizationMember record and all TeamMember records
 * within this organization. Does NOT delete the User record (they can still
 * log in and join other orgs).
 *
 * Guards:
 * - Cannot remove yourself
 * - Cannot remove the last OWNER (org must always have at least one)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const { id: membershipId } = await params

    // Find the membership
    const membership = await prisma.organizationMember.findUnique({
      where: { id: membershipId },
      include: { user: true },
    })

    if (!membership) {
      throw new AppError('NOT_FOUND', 'Membership not found', 404)
    }

    if (membership.organizationId !== session.organizationId) {
      throw new AppError('FORBIDDEN', 'Cannot modify members of another organization', 403)
    }

    // Cannot remove yourself
    if (membership.userId === session.dbUser.id) {
      throw new AppError('FORBIDDEN', 'Cannot remove yourself from the organization', 403)
    }

    // Check if this user is the last OWNER
    const userTeamMemberships = await prisma.teamMember.findMany({
      where: {
        userId: membership.userId,
        team: { organizationId: session.organizationId },
      },
      include: { role: true },
    })

    const isOwner = userTeamMemberships.some((tm) => tm.role.name === 'OWNER')
    if (isOwner) {
      // Count other owners in the org
      const ownerRole = await prisma.role.findFirst({
        where: { organizationId: session.organizationId, name: 'OWNER' },
      })
      if (ownerRole) {
        const ownerCount = await prisma.teamMember.count({
          where: {
            roleId: ownerRole.id,
            team: { organizationId: session.organizationId },
          },
        })
        if (ownerCount <= 1) {
          throw new AppError(
            'FORBIDDEN',
            'Cannot remove the last owner. Transfer ownership first.',
            403,
          )
        }
      }
    }

    // Remove all team memberships in this org
    const orgTeams = await prisma.team.findMany({
      where: { organizationId: session.organizationId },
      select: { id: true },
    })
    const orgTeamIds = orgTeams.map((t) => t.id)

    await prisma.teamMember.deleteMany({
      where: {
        userId: membership.userId,
        teamId: { in: orgTeamIds },
      },
    })

    // Remove the organization membership
    await prisma.organizationMember.delete({
      where: { id: membershipId },
    })

    return NextResponse.json({ data: { id: membershipId, removed: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
