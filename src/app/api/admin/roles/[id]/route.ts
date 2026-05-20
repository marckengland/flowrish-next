import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse, AppError } from '@/lib/errors'
import { PERMISSIONS } from '@/types/permissions'

/**
 * PATCH /api/admin/roles/[id] — Update a role's name, hierarchy, or permissions.
 *
 * Body: { name?, hierarchy?, permissions?: string[] }
 *
 * - System roles (OWNER, ADMIN, MANAGER, MEMBER) cannot be deleted but
 *   their permissions CAN be modified by the OWNER.
 * - Hierarchy of system roles cannot be changed.
 * - Custom roles can be fully edited.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const { id } = await params
    const body = await request.json()
    const { name, hierarchy, permissions } = body as {
      name?: string
      hierarchy?: number
      permissions?: string[]
    }

    // Fetch the role
    const role = await prisma.role.findFirst({
      where: { id, organizationId: session.organizationId },
      include: { permissions: true },
    })
    if (!role) {
      throw new AppError('NOT_FOUND', 'Role not found', 404)
    }

    // Prevent hierarchy change on system roles
    if (role.isSystem && hierarchy !== undefined && hierarchy !== role.hierarchy) {
      throw new AppError(
        'FORBIDDEN',
        'Cannot change the hierarchy of a system role',
        403,
      )
    }

    // Prevent renaming system roles
    if (role.isSystem && name !== undefined && name.trim() !== role.name) {
      throw new AppError(
        'FORBIDDEN',
        'Cannot rename a system role',
        403,
      )
    }

    // Privilege escalation check for hierarchy changes
    if (hierarchy !== undefined) {
      const callerHierarchy = Math.min(
        ...session.dbUser.teamMemberships.map((m) => m.role.hierarchy),
      )
      if (hierarchy < callerHierarchy) {
        throw new AppError(
          'FORBIDDEN',
          'Cannot set a role hierarchy higher than your own',
          403,
        )
      }
    }

    // Validate permissions if provided
    if (permissions !== undefined) {
      if (!Array.isArray(permissions)) {
        throw new AppError('VALIDATION_ERROR', 'Permissions must be an array', 400)
      }
      const validPermissions = new Set(PERMISSIONS as readonly string[])
      const invalidPerms = permissions.filter((p) => !validPermissions.has(p))
      if (invalidPerms.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid permissions: ${invalidPerms.join(', ')}`,
          400,
        )
      }
    }

    // Update role fields
    const updateData: Record<string, unknown> = {}
    if (name !== undefined && !role.isSystem) updateData.name = name.trim()
    if (hierarchy !== undefined && !role.isSystem) updateData.hierarchy = hierarchy

    // Update permissions if provided (delete all existing, recreate)
    if (permissions !== undefined) {
      await prisma.rolePermission.deleteMany({ where: { roleId: id } })
      await prisma.rolePermission.createMany({
        data: permissions.map((key) => ({ roleId: id, key })),
      })
    }

    // Update the role record if there are field changes
    let updated = role
    if (Object.keys(updateData).length > 0) {
      updated = await prisma.role.update({
        where: { id },
        data: updateData,
        include: { permissions: true },
      })
    } else if (permissions !== undefined) {
      // Refetch to get updated permissions
      updated = await prisma.role.findUnique({
        where: { id },
        include: { permissions: true },
      }) as typeof role
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/admin/roles/[id] — Delete a custom role.
 *
 * - System roles cannot be deleted.
 * - Roles with active team members cannot be deleted (reassign first).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const { id } = await params

    const role = await prisma.role.findFirst({
      where: { id, organizationId: session.organizationId },
      include: { _count: { select: { teamMembers: true } } },
    })
    if (!role) {
      throw new AppError('NOT_FOUND', 'Role not found', 404)
    }

    if (role.isSystem) {
      throw new AppError(
        'FORBIDDEN',
        'System roles (OWNER, ADMIN, MANAGER, MEMBER) cannot be deleted',
        403,
      )
    }

    if (role._count.teamMembers > 0) {
      throw new AppError(
        'CONFLICT',
        `Cannot delete role "${role.name}" — it is assigned to ${role._count.teamMembers} team member(s). Reassign them first.`,
        409,
      )
    }

    // Delete permissions first (cascade should handle this, but be explicit)
    await prisma.rolePermission.deleteMany({ where: { roleId: id } })
    await prisma.role.delete({ where: { id } })

    return NextResponse.json({ data: { id, deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
