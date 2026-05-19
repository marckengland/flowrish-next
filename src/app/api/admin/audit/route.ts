import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/audit — List audit entries with pagination and filters.
 *
 * Query params: page, pageSize, entityType, userId, action
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'audit:read')

    const { searchParams } = request.nextUrl
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)))
    const entityType = searchParams.get('entityType') ?? undefined
    const userId = searchParams.get('userId') ?? undefined
    const action = searchParams.get('action') ?? undefined

    const db = createTenantPrisma(session.organizationId)

    const where: Record<string, unknown> = {}
    if (entityType) where.entityType = entityType
    if (userId) where.userId = userId
    if (action) where.action = action

    const [entries, total] = await Promise.all([
      db.auditEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.auditEntry.count({ where }),
    ])

    return NextResponse.json({
      data: entries,
      total,
      page,
      pageSize,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
