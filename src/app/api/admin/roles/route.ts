import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse, AppError } from '@/lib/errors'
import { PERMISSIONS } from '@/types/permissions'

/**
 * GET /api/admin/roles — List all roles for the organization with permissions.
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const roles = await prisma.role.findMany({
      where: { organizationId: session.organizationId },
      include: { permissions: true },
      orderBy: { hierarchy: 'asc' },
    })

    // Also return the full list of available permissions for the UI
    return NextResponse.json({ data: roles, availablePermissions: PERMISSIONS })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/admin/roles — Create a custom role with selected permissions.
 *
 * Body: { name, hierarchy, permissions: string[] }
 *
 * - name: display name for the role (must be unique within the org)
 * - hierarchy: number (lower = more powerful). Must be >= caller's hierarchy
 * - permissions: array of permission keys to assign
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:users')

    const body = await request.json()
    const { name, hierarchy, permissions } = body as {
      name: string
      hierarchy: number
      permissions: string[]
    }

    // Validate inputs
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError('VALIDATION_ERROR', 'Role name is required', 400)
    }
    if (typeof hierarchy !== 'number' || hierarchy < 0) {
      throw new AppError('VALIDATION_ERROR', 'Hierarchy must be a non-negative number', 400)
    }
    if (!Array.isArray(permissions)) {
      throw new AppError('VALIDATION_ERROR', 'Permissions must be an array', 400)
    }

    // Validate all permission keys are valid
    const validPermissions = new Set(PERMISSIONS as readonly string[])
    const invalidPerms = permissions.filter((p) => !validPermissions.has(p))
    if (invalidPerms.length > 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Invalid permissions: ${invalidPerms.join(', ')}`,
        400,
      )
    }

    // Prevent privilege escalation: caller can't create a role more powerful than their own
    const callerHierarchy = Math.min(
      ...session.dbUser.teamMemberships.map((m) => m.role.hierarchy),
    )
    if (hierarchy < callerHierarchy) {
      throw new AppError(
        'FORBIDDEN',
        'Cannot create a role with higher privilege than your own',
        403,
      )
    }

    // Check name uniqueness within the org
    const existing = await prisma.role.findFirst({
      where: {
        organizationId: session.organizationId,
        name: name.trim(),
      },
    })
    if (existing) {
      throw new AppError('CONFLICT', 'A role with this name already exists', 409)
    }

    // Create the role with permissions
    const role = await prisma.role.create({
      data: {
        name: name.trim(),
        organizationId: session.organizationId,
        isSystem: false,
        hierarchy,
        permissions: {
          create: permissions.map((key) => ({ key })),
        },
      },
      include: { permissions: true },
    })

    return NextResponse.json({ data: role }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
