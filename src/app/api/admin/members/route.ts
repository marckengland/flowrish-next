import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/members — List organization members with user info and roles.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const members = await prisma.organizationMember.findMany({
      where: { organizationId: session.organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
      },
    })

    // Fetch team memberships with roles for each user
    const userIds = members.map((m) => m.user.id)
    const teamMemberships = await prisma.teamMember.findMany({
      where: {
        userId: { in: userIds },
        team: { organizationId: session.organizationId },
      },
      include: {
        role: { select: { id: true, name: true, hierarchy: true } },
        team: { select: { id: true, name: true } },
      },
    })

    // Group team memberships by userId
    const membershipsByUser = new Map<string, typeof teamMemberships>()
    for (const tm of teamMemberships) {
      const existing = membershipsByUser.get(tm.userId) ?? []
      existing.push(tm)
      membershipsByUser.set(tm.userId, existing)
    }

    const data = members.map((m) => ({
      ...m,
      teamMemberships: membershipsByUser.get(m.user.id) ?? [],
    }))

    return NextResponse.json({ data })
  } catch (error) {
    return errorResponse(error)
  }
}
