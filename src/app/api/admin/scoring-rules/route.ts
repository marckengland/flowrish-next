import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/scoring-rules — List scoring rules.
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const db = createTenantPrisma(session.organizationId)
    const rules = await db.scoringRule.findMany({
      orderBy: { type: 'asc' },
    })

    return NextResponse.json({ data: rules })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/admin/scoring-rules — Create a scoring rule.
 *
 * Body: { type, points, config, isActive }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const body = await request.json()
    const { type, points, config, isActive } = body

    const db = createTenantPrisma(session.organizationId)
    const rule = await db.scoringRule.create({
      data: tenantData({
        type,
        points: points ?? 1,
        config: config ?? {},
        isActive: isActive ?? true,
      }),
    })

    return NextResponse.json({ data: rule }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
