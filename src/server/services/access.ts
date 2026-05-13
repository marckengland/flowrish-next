import type { SessionUser } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { getAccessibleTeamIds } from '@/server/services/teams'

/**
 * Prisma where clause type for lead access filtering.
 * This can be spread into any Prisma lead query to enforce RBAC scoping.
 */
export interface LeadAccessFilter {
  deletedAt: null
  assignedUserId?: string | { in: string[] }
}

/**
 * Returns a Prisma `where` clause that scopes lead queries based on the
 * user's role hierarchy. This filter should be spread into all lead queries
 * to enforce role-based access control.
 *
 * Access rules:
 * - OWNER/ADMIN (hierarchy <= 1): all org leads (deletedAt: null)
 *   Tenant isolation middleware handles organizationId scoping.
 * - MANAGER (hierarchy = 2): leads assigned to users in their accessible teams + sub-teams
 * - MEMBER (hierarchy >= 3): only leads assigned to themselves
 *
 * Always includes `deletedAt: null` to exclude soft-deleted leads.
 *
 * Validates: Requirements 3.2, 3.3, 3.4, 3.5
 */
export async function getLeadAccessFilter(
  user: SessionUser,
  organizationId: string,
): Promise<LeadAccessFilter> {
  // Determine the highest privilege level (lowest hierarchy number)
  const highestPrivilege = getHighestPrivilege(user)

  // OWNER or ADMIN (hierarchy <= 1): access to all org leads
  if (highestPrivilege <= 1) {
    return { deletedAt: null }
  }

  // MEMBER (hierarchy >= 3): only own assigned leads
  if (highestPrivilege >= 3) {
    return {
      deletedAt: null,
      assignedUserId: user.id,
    }
  }

  // MANAGER (hierarchy = 2): leads assigned to users in accessible teams
  const accessibleTeamIds = await getAccessibleTeamIds(user.id, organizationId)

  // Get all user IDs that are members of the accessible teams
  const teamMembers = await prisma.teamMember.findMany({
    where: {
      teamId: { in: accessibleTeamIds },
    },
    select: { userId: true },
  })

  // Deduplicate user IDs
  const accessibleUserIds = [...new Set(teamMembers.map((m) => m.userId))]

  return {
    deletedAt: null,
    assignedUserId: { in: accessibleUserIds },
  }
}

/**
 * Determines the highest privilege level (lowest hierarchy number)
 * across all of the user's team memberships.
 */
function getHighestPrivilege(user: SessionUser): number {
  if (user.teamMemberships.length === 0) {
    // No memberships — treat as lowest privilege
    return Infinity
  }

  return Math.min(...user.teamMemberships.map((m) => m.role.hierarchy))
}
