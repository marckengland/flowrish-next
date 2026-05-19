import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  type DefaultRole,
} from '@/types/permissions'

/**
 * Organization service — handles creation, invitations, and membership.
 *
 * On org creation:
 * 1. Create the Organization record
 * 2. Create default "General" team
 * 3. Create 4 default roles (OWNER, ADMIN, MANAGER, MEMBER) with system permissions
 * 4. Add owner as OrganizationMember (isDefault: true)
 * 5. Add owner as TeamMember with OWNER role
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7
 */

const INVITE_EXPIRATION_DAYS = 7

/**
 * Creates a new organization with default team, roles, and owner membership.
 *
 * @param name - Display name for the organization
 * @param slug - URL-safe unique identifier (e.g. "acme-corp")
 * @param ownerId - User ID of the organization owner
 * @returns The created organization with its default team and roles
 */
export async function createOrganization(
  name: string,
  slug: string,
  ownerId: string,
) {
  if (!name.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Organization name is required', 400)
  }
  if (!slug.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Organization slug is required', 400)
  }
  if (!ownerId.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Owner ID is required', 400)
  }

  // Check slug uniqueness
  const existingOrg = await prisma.organization.findUnique({
    where: { slug },
  })
  if (existingOrg) {
    throw new AppError('CONFLICT', 'An organization with this slug already exists', 409)
  }

  // Verify the owner user exists
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
  })
  if (!owner) {
    throw new AppError('NOT_FOUND', 'User not found', 404)
  }

  // Create org and related records sequentially.
  // PgBouncer (Supabase pooler) doesn't support interactive transactions,
  // so we use sequential creates. If a step fails, the org is left in a
  // partial state — but this is acceptable for onboarding since the user
  // can retry, and partial orgs without members are harmless.

  // 1. Create the Organization
  const organization = await prisma.organization.create({
    data: {
      name: name.trim(),
      slug: slug.trim(),
    },
  })

  // 2. Create default "General" team
  const defaultTeam = await prisma.team.create({
    data: {
      name: 'General',
      organizationId: organization.id,
    },
  })

  // 3. Create default roles with system permissions
  const roles = await createDefaultRoles(organization.id)

  // 4. Add owner as OrganizationMember (isDefault: true)
  await prisma.organizationMember.create({
    data: {
      userId: ownerId,
      organizationId: organization.id,
      isDefault: true,
    },
  })

  // 5. Add owner as TeamMember with OWNER role
  const ownerRole = roles.find((r) => r.name === 'OWNER')!
  await prisma.teamMember.create({
    data: {
      userId: ownerId,
      teamId: defaultTeam.id,
      roleId: ownerRole.id,
    },
  })

  return { organization, defaultTeam, roles }
}

/**
 * Creates an invitation to join an organization.
 *
 * @param email - Email address of the invitee
 * @param organizationId - Organization to invite to
 * @param roleId - Role to assign on acceptance
 * @param invitedById - User ID of the person sending the invite
 * @param teamId - Optional team to add the user to on acceptance
 * @returns The created invite record
 */
export async function inviteToOrganization(
  email: string,
  organizationId: string,
  roleId: string,
  invitedById: string,
  teamId?: string,
) {
  if (!email.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Email is required', 400)
  }
  if (!organizationId.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Organization ID is required', 400)
  }
  if (!roleId.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Role ID is required', 400)
  }
  if (!invitedById.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Inviter ID is required', 400)
  }

  // Verify the organization exists
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  })
  if (!organization) {
    throw new AppError('NOT_FOUND', 'Organization not found', 404)
  }

  // Verify the role exists and belongs to this organization
  const role = await prisma.role.findUnique({
    where: { id: roleId },
  })
  if (!role) {
    throw new AppError('NOT_FOUND', 'Role not found', 404)
  }
  if (role.organizationId !== null && role.organizationId !== organizationId) {
    throw new AppError('FORBIDDEN', 'Role does not belong to this organization', 403)
  }

  // Prevent privilege escalation: the inviter must have a role with equal or
  // higher privilege (lower hierarchy number) than the role being assigned.
  const inviterMemberships = await prisma.teamMember.findMany({
    where: {
      userId: invitedById,
      team: { organizationId },
    },
    include: { role: { select: { hierarchy: true } } },
  })
  if (inviterMemberships.length === 0) {
    throw new AppError('FORBIDDEN', 'Inviter is not a member of this organization', 403)
  }
  const inviterHighestPrivilege = Math.min(
    ...inviterMemberships.map((m) => m.role.hierarchy),
  )
  if (role.hierarchy < inviterHighestPrivilege) {
    throw new AppError(
      'FORBIDDEN',
      'Cannot invite with a role that has higher privilege than your own',
      403,
    )
  }

  // Verify the team belongs to this organization (if provided)
  if (teamId) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
    })
    if (!team || team.organizationId !== organizationId) {
      throw new AppError('NOT_FOUND', 'Team not found in this organization', 404)
    }
  }

  // Check for existing pending invite for same email + org
  const existingInvite = await prisma.organizationInvite.findFirst({
    where: {
      email: email.toLowerCase().trim(),
      organizationId,
      status: 'pending',
    },
  })
  if (existingInvite) {
    throw new AppError(
      'CONFLICT',
      'A pending invite already exists for this email',
      409,
    )
  }

  // Check if user is already a member
  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  })
  if (existingUser) {
    const existingMembership = await prisma.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: existingUser.id,
          organizationId,
        },
      },
    })
    if (existingMembership) {
      throw new AppError(
        'CONFLICT',
        'User is already a member of this organization',
        409,
      )
    }
  }

  // Create the invite with 7-day expiration
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRATION_DAYS)

  const invite = await prisma.organizationInvite.create({
    data: {
      email: email.toLowerCase().trim(),
      organizationId,
      roleId,
      teamId: teamId ?? null,
      invitedById,
      status: 'pending',
      expiresAt,
    },
  })

  return invite
}

/**
 * Accepts an organization invite — creates OrganizationMember and TeamMember,
 * marks the invite as accepted.
 *
 * @param inviteId - The invite to accept
 * @param userId - The user accepting the invite
 * @returns The created membership records
 */
export async function acceptInvite(inviteId: string, userId: string) {
  if (!inviteId.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Invite ID is required', 400)
  }
  if (!userId.trim()) {
    throw new AppError('VALIDATION_ERROR', 'User ID is required', 400)
  }

  // Fetch the invite
  const invite = await prisma.organizationInvite.findUnique({
    where: { id: inviteId },
  })
  if (!invite) {
    throw new AppError('NOT_FOUND', 'Invite not found', 404)
  }

  // Verify invite is still pending
  if (invite.status !== 'pending') {
    throw new AppError(
      'CONFLICT',
      `Invite has already been ${invite.status}`,
      409,
    )
  }

  // Verify invite hasn't expired
  if (new Date() > invite.expiresAt) {
    // Mark as expired
    await prisma.organizationInvite.update({
      where: { id: inviteId },
      data: { status: 'expired' },
    })
    throw new AppError('GONE', 'Invite has expired', 410)
  }

  // Verify the user's email matches the invite
  const user = await prisma.user.findUnique({
    where: { id: userId },
  })
  if (!user) {
    throw new AppError('NOT_FOUND', 'User not found', 404)
  }
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new AppError(
      'FORBIDDEN',
      'This invite was sent to a different email address',
      403,
    )
  }

  // Check if user is already a member
  const existingMembership = await prisma.organizationMember.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId: invite.organizationId,
      },
    },
  })
  if (existingMembership) {
    // Mark invite as accepted anyway and return
    await prisma.organizationInvite.update({
      where: { id: inviteId },
      data: { status: 'accepted' },
    })
    throw new AppError(
      'CONFLICT',
      'User is already a member of this organization',
      409,
    )
  }

  // Sequential operations (PgBouncer doesn't support interactive transactions)
  // Determine if this is the user's first org (make it default)
  const existingMemberships = await prisma.organizationMember.findMany({
    where: { userId },
  })
  const isDefault = existingMemberships.length === 0

  // Create OrganizationMember
  const membership = await prisma.organizationMember.create({
    data: {
      userId,
      organizationId: invite.organizationId,
      isDefault,
    },
  })

  // Create TeamMember if a team was specified in the invite
  let teamMember = null
  if (invite.teamId) {
    teamMember = await prisma.teamMember.create({
      data: {
        userId,
        teamId: invite.teamId,
        roleId: invite.roleId,
      },
    })
  } else {
    // If no team specified, add to the default "General" team
    const defaultTeam = await prisma.team.findFirst({
      where: {
        organizationId: invite.organizationId,
        name: 'General',
        parentTeamId: null,
      },
    })
    if (defaultTeam) {
      teamMember = await prisma.teamMember.create({
        data: {
          userId,
          teamId: defaultTeam.id,
          roleId: invite.roleId,
        },
      })
    }
  }

  // Mark invite as accepted
  await prisma.organizationInvite.update({
    where: { id: inviteId },
    data: { status: 'accepted' },
  })

  return { membership, teamMember }
}

/**
 * Creates the 4 default system roles for an organization:
 * OWNER, ADMIN, MANAGER, MEMBER — each with their predefined permissions.
 *
 * These roles are marked as `isSystem: true` and have a hierarchy value
 * that determines their power level (lower = more powerful).
 */
async function createDefaultRoles(organizationId: string) {
  const roleNames: DefaultRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']
  const roles = []

  for (const roleName of roleNames) {
    const role = await prisma.role.create({
      data: {
        name: roleName,
        organizationId,
        isSystem: true,
        hierarchy: ROLE_HIERARCHY[roleName],
        permissions: {
          create: DEFAULT_ROLE_PERMISSIONS[roleName].map((key) => ({ key })),
        },
      },
      include: { permissions: true },
    })
    roles.push(role)
  }

  return roles
}
