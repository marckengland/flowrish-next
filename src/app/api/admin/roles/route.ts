import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { prisma } from '@/server/db/client'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/roles — List all roles for the organization with permissions.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const roles = await prisma.role.findMany({
      where: { organizationId: session.organizationId },
      include: { permissions: true },
      orderBy: { hierarchy: 'asc' },
    })

    return NextResponse.json({ data: roles })
  } catch (error) {
    return errorResponse(error)
  }
}
