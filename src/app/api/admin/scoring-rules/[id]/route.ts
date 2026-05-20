import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * PATCH /api/admin/scoring-rules/[id] — Update a scoring rule.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const { id } = await params
    const body = await request.json()
    const { isActive, points, config } = body

    const db = createTenantPrisma(session.organizationId)

    const existing = await db.scoringRule.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Scoring rule not found', 404)
    }

    const data: Record<string, unknown> = {}
    if (isActive !== undefined) data.isActive = isActive
    if (points !== undefined) data.points = points
    if (config !== undefined) data.config = config

    const updated = await db.scoringRule.update({ where: { id }, data })

    return NextResponse.json({ data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/admin/scoring-rules/[id] — Delete a scoring rule.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'settings:manage')

    const { id } = await params
    const db = createTenantPrisma(session.organizationId)

    const existing = await db.scoringRule.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Scoring rule not found', 404)
    }

    await db.scoringRule.delete({ where: { id } })

    return NextResponse.json({ data: { id, deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
