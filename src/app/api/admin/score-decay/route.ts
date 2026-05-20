import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/admin/score-decay — List score decay configurations.
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const db = createTenantPrisma(session.organizationId)
    const configs = await db.scoreDecayConfig.findMany({
      orderBy: { id: 'desc' },
    })

    return NextResponse.json({ data: configs })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/admin/score-decay — Create a score decay configuration.
 *
 * Body: { inactivityDays, pointReduction, isActive }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')

    const body = await request.json()
    const { inactivityDays, pointReduction, isActive } = body

    const db = createTenantPrisma(session.organizationId)
    const config = await db.scoreDecayConfig.create({
      data: tenantData({
        inactivityDays: inactivityDays ?? 14,
        pointReduction: pointReduction ?? 5,
        isActive: isActive ?? true,
      }),
    })

    return NextResponse.json({ data: config }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
