import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/audit — List audit entries with pagination and filters.
 *
 * Query params:
 * - page (default 1)
 * - pageSize (default 25, max 100)
 * - entityType (e.g. 'Lead', 'Cadence')
 * - userId (filter by actor)
 * - action (CREATE/UPDATE/DELETE/etc.)
 * - fromDate (ISO date string)
 * - toDate (ISO date string)
 *
 * Response shape: { data: { entries, pagination } }
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
    const fromDate = searchParams.get('fromDate') ?? undefined
    const toDate = searchParams.get('toDate') ?? undefined

    const db = createTenantPrisma(session.organizationId)

    const where: Record<string, unknown> = {}
    if (entityType) where.entityType = entityType
    if (userId) where.userId = userId
    if (action) where.action = action

    // Date range filtering
    if (fromDate || toDate) {
      const dateFilter: Record<string, Date> = {}
      if (fromDate) {
        const from = new Date(fromDate)
        if (!isNaN(from.getTime())) dateFilter.gte = from
      }
      if (toDate) {
        const to = new Date(toDate)
        if (!isNaN(to.getTime())) {
          to.setHours(23, 59, 59, 999)
          dateFilter.lte = to
        }
      }
      if (Object.keys(dateFilter).length > 0) {
        where.createdAt = dateFilter
      }
    }

    const [entries, total] = await Promise.all([
      db.auditEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      db.auditEntry.count({ where }),
    ])

    const totalPages = Math.ceil(total / pageSize) || 1

    return NextResponse.json({
      data: {
        entries,
        pagination: { page, pageSize, total, totalPages },
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
