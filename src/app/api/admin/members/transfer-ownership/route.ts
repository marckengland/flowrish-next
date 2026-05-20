import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * POST /api/admin/members/transfer-ownership — Transfer OWNER role to another member.
 *
 * Body: { targetUserId }
 *
 * - Only the current OWNER can transfer ownership
 * - The target user must be an existing org member
 * - The current OWNER is downgraded to ADMIN after transfer
 * - The target user's highest role becomes OWNER
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const body = await request.json()
    const { targetUserId } = body as { targetUserId: string }

    if (!targetUserId) {
      throw new AppError('VALIDATION_ERROR', 'Target user ID is required', 400)
    }

    const orgId = session.organizationId
    const currentUserId = session.dbUser.id

    // Verify caller is actually an OWNER
    const ownerRole = await prisma.role.findFirst({
      where: { organizationId: orgId, name: 'OWNER' },
    })
    if (!ownerRole) {
      throw new AppError('NOT_FOUND', 'Owner role not found', 404)
    }

    const callerIsOwner = await prisma.teamMember.findFirst({
      where: {
        userId: currentUserId,
        roleId: ownerRole.id,
        team: { organizationId: orgId },
      },
    })
    if (!callerIsOwner) {
      throw new AppError('FORBIDDEN', 'Only the owner can transfer ownership', 403)
    }

    // Verify target is an org member
    const targetMembership = await prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: targetUserId, organizationId: orgId } },
    })
    if (!targetMembership) {
      throw new AppError('NOT_FOUND', 'Target user is not a member of this organization', 404)
    }

    // Can't transfer to yourself
    if (targetUserId === currentUserId) {
      throw new AppError('VALIDATION_ERROR', 'Cannot transfer ownership to yourself', 400)
    }

    // Find the ADMIN role for downgrading the current owner
    const adminRole = await prisma.role.findFirst({
      where: { organizationId: orgId, name: 'ADMIN' },
    })
    if (!adminRole) {
      throw new AppError('NOT_FOUND', 'Admin role not found', 404)
    }

    // Find target user's team membership (any team in this org)
    const targetTeamMembership = await prisma.teamMember.findFirst({
      where: {
        userId: targetUserId,
        team: { organizationId: orgId },
      },
    })

    if (targetTeamMembership) {
      // Update target's role to OWNER
      await prisma.teamMember.update({
        where: { id: targetTeamMembership.id },
        data: { roleId: ownerRole.id },
      })
    } else {
      // Target has no team membership — add them to the General team as OWNER
      const generalTeam = await prisma.team.findFirst({
        where: { organizationId: orgId, name: 'General', parentTeamId: null },
      })
      if (generalTeam) {
        await prisma.teamMember.create({
          data: {
            userId: targetUserId,
            teamId: generalTeam.id,
            roleId: ownerRole.id,
          },
        })
      }
    }

    // Downgrade current owner to ADMIN
    await prisma.teamMember.update({
      where: { id: callerIsOwner.id },
      data: { roleId: adminRole.id },
    })

    return NextResponse.json({
      data: {
        newOwnerId: targetUserId,
        previousOwnerId: currentUserId,
        previousOwnerNewRole: 'ADMIN',
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
