import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse, AppError } from '@/lib/errors'

/**
 * PATCH /api/admin/score-decay/[id] — Update a score decay configuration.
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
    const { isActive, inactivityDays, pointReduction } = body

    const db = createTenantPrisma(session.organizationId)

    const existing = await db.scoreDecayConfig.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Score decay config not found', 404)
    }

    const data: Record<string, unknown> = {}
    if (isActive !== undefined) data.isActive = isActive
    if (inactivityDays !== undefined) data.inactivityDays = inactivityDays
    if (pointReduction !== undefined) data.pointReduction = pointReduction

    const updated = await db.scoreDecayConfig.update({ where: { id }, data })

    return NextResponse.json({ data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/admin/score-decay/[id] — Delete a score decay configuration.
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

    const existing = await db.scoreDecayConfig.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Score decay config not found', 404)
    }

    await db.scoreDecayConfig.delete({ where: { id } })

    return NextResponse.json({ data: { id, deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
