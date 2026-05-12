import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createCadence } from '@/server/services/cadences'
import { createTenantPrisma } from '@/server/db/middleware'
import { paginationSchema } from '@/lib/validators/common'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/cadences — List cadences with pagination.
 *
 * Query params: page, pageSize, status
 *
 * Validates: Requirements 6.1, 32.1
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:read')

    const { searchParams } = request.nextUrl

    const pagination = paginationSchema.parse({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    })

    const statusFilter = searchParams.get('status') ?? undefined

    const db = createTenantPrisma(session.organizationId)

    const where: Record<string, unknown> = {}
    if (statusFilter) {
      where.status = statusFilter
    }

    const [cadences, total] = await Promise.all([
      db.cadence.findMany({
        where,
        include: {
          steps: { orderBy: { stepOrder: 'asc' } },
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      db.cadence.count({ where }),
    ])

    return NextResponse.json({
      data: cadences,
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/cadences — Create a new cadence.
 *
 * Body: { name, description? }
 *
 * Validates: Requirements 6.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const body = await request.json()
    const cadence = await createCadence(body, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: cadence }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
