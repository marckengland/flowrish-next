import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { getSubTeamIds } from '@/server/auth/permissions'

/**
 * Represents a team node in the hierarchy tree structure.
 */
export interface TeamTreeNode {
  id: string
  name: string
  parentTeamId: string | null
  organizationId: string
  createdAt: Date
  updatedAt: Date
  members: {
    id: string
    userId: string
    roleId: string
  }[]
  children: TeamTreeNode[]
}

/**
 * Creates a new team within an organization, optionally nested under a parent team.
 *
 * Validates that:
 * - The organization exists
 * - If parentTeamId is provided, the parent team exists and belongs to the same organization
 *
 * Validates: Requirement 2.5
 */
export async function createTeam(
  name: string,
  orgId: string,
  parentTeamId?: string,
) {
  // Validate organization exists
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  })

  if (!org) {
    throw new AppError('NOT_FOUND', 'Organization not found', 404)
  }

  // Validate parent team if provided
  if (parentTeamId) {
    const parentTeam = await prisma.team.findUnique({
      where: { id: parentTeamId },
      select: { id: true, organizationId: true },
    })

    if (!parentTeam) {
      throw new AppError('NOT_FOUND', 'Parent team not found', 404)
    }

    if (parentTeam.organizationId !== orgId) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Parent team does not belong to the same organization',
        400,
      )
    }
  }

  return prisma.team.create({
    data: {
      name,
      organizationId: orgId,
      parentTeamId: parentTeamId ?? null,
    },
    include: {
      members: true,
      childTeams: true,
    },
  })
}

/**
 * Adds a user as a member of a team with a specific role.
 *
 * Validates that:
 * - The team exists
 * - The user exists
 * - The role exists
 * - The user is not already a member of the team (unique constraint on [userId, teamId])
 *
 * Validates: Requirement 2.5
 */
export async function addTeamMember(
  userId: string,
  teamId: string,
  roleId: string,
) {
  // Validate team exists
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, organizationId: true },
  })

  if (!team) {
    throw new AppError('NOT_FOUND', 'Team not found', 404)
  }

  // Validate user exists
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found', 404)
  }

  // Validate user is a member of the team's organization
  const orgMembership = await prisma.organizationMember.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId: team.organizationId,
      },
    },
  })
  if (!orgMembership) {
    throw new AppError(
      'FORBIDDEN',
      'User must be a member of the organization before joining a team',
      403,
    )
  }

  // Validate role exists
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    select: { id: true },
  })

  if (!role) {
    throw new AppError('NOT_FOUND', 'Role not found', 404)
  }

  // Check if user is already a member of this team
  const existingMember = await prisma.teamMember.findUnique({
    where: { userId_teamId: { userId, teamId } },
  })

  if (existingMember) {
    throw new AppError(
      'CONFLICT',
      'User is already a member of this team',
      409,
    )
  }

  return prisma.teamMember.create({
    data: {
      userId,
      teamId,
      roleId,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      role: { select: { id: true, name: true, hierarchy: true } },
      team: { select: { id: true, name: true } },
    },
  })
}

/**
 * Returns the full team hierarchy for an organization as a nested tree structure.
 *
 * Fetches all teams in the organization and assembles them into a tree
 * where root teams (no parentTeamId) are top-level nodes and child teams
 * are nested under their parents.
 *
 * Validates: Requirement 2.5
 */
export async function getTeamHierarchy(orgId: string): Promise<TeamTreeNode[]> {
  const teams = await prisma.team.findMany({
    where: { organizationId: orgId },
    include: {
      members: {
        select: { id: true, userId: true, roleId: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Build a map for quick lookup
  const teamMap = new Map<string, TeamTreeNode>()

  for (const team of teams) {
    teamMap.set(team.id, {
      id: team.id,
      name: team.name,
      parentTeamId: team.parentTeamId,
      organizationId: team.organizationId,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      members: team.members,
      children: [],
    })
  }

  // Assemble tree structure
  const roots: TeamTreeNode[] = []

  for (const node of teamMap.values()) {
    if (node.parentTeamId && teamMap.has(node.parentTeamId)) {
      teamMap.get(node.parentTeamId)!.children.push(node)
    } else {
      // Root team (no parent or parent not in this org)
      roots.push(node)
    }
  }

  return roots
}

/**
 * Resolves all team IDs that a user has access to within an organization,
 * based on their role hierarchy.
 *
 * Access rules:
 * - OWNER/ADMIN (hierarchy <= 1): all teams in the organization
 * - MANAGER (hierarchy = 2): their direct teams + all sub-teams (recursive)
 * - MEMBER (hierarchy = 3): only their direct teams
 *
 * Per Requirement 2.8: When a user belongs to multiple Teams, the union of
 * permissions from all team memberships is granted.
 *
 * Per Requirement 3.8: A MANAGER of a parent team has MANAGER access to all sub-teams.
 *
 * Validates: Requirements 2.8, 3.8
 */
export async function getAccessibleTeamIds(
  userId: string,
  orgId: string,
): Promise<string[]> {
  // Fetch user's team memberships in this organization with role info
  const memberships = await prisma.teamMember.findMany({
    where: {
      userId,
      team: { organizationId: orgId },
    },
    include: {
      role: { select: { hierarchy: true } },
      team: { select: { id: true } },
    },
  })

  if (memberships.length === 0) {
    return []
  }

  // Determine the highest privilege level (lowest hierarchy number)
  const highestPrivilege = Math.min(
    ...memberships.map((m) => m.role.hierarchy),
  )

  // OWNER or ADMIN (hierarchy <= 1): access to all teams in the org
  if (highestPrivilege <= 1) {
    const allTeams = await prisma.team.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    })
    return allTeams.map((t) => t.id)
  }

  // Collect accessible team IDs
  const accessibleTeamIds = new Set<string>()

  for (const membership of memberships) {
    // Always include the direct team
    accessibleTeamIds.add(membership.team.id)

    // MANAGER (hierarchy = 2): include all sub-teams
    if (membership.role.hierarchy === 2) {
      const subTeamIds = await getSubTeamIds(membership.team.id)
      for (const subTeamId of subTeamIds) {
        accessibleTeamIds.add(subTeamId)
      }
    }
    // MEMBER (hierarchy = 3): only direct teams (already added above)
  }

  return Array.from(accessibleTeamIds)
}
