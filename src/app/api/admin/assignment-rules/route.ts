import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/assignment-rules — List assignment rules ordered by priority.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const db = createTenantPrisma(session.organizationId)

    const rules = await db.assignmentRule.findMany({
      orderBy: { priority: 'asc' },
    })

    return NextResponse.json({ data: rules })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/admin/assignment-rules — Create a new assignment rule.
 *
 * Body: { type, config, priority, isActive }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const body = await request.json()
    const { type, config, priority, isActive } = body

    const db = createTenantPrisma(session.organizationId)

    const rule = await db.assignmentRule.create({
      data: tenantData({
        type,
        config,
        priority,
        isActive: isActive ?? true,
      }),
    })

    return NextResponse.json({ data: rule }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
