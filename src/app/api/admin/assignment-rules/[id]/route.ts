import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse, AppError } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid assignment rule ID'),
})

/**
 * PATCH /api/admin/assignment-rules/[id] — Update an assignment rule.
 *
 * Body: { isActive?, priority?, config? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { isActive, priority, config } = body

    const db = createTenantPrisma(session.organizationId)

    const existing = await db.assignmentRule.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Assignment rule not found', 404)
    }

    const data: Record<string, unknown> = {}
    if (isActive !== undefined) data.isActive = isActive
    if (priority !== undefined) data.priority = priority
    if (config !== undefined) data.config = config

    const updated = await db.assignmentRule.update({
      where: { id },
      data,
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/admin/assignment-rules/[id] — Delete an assignment rule.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'users:manage')

    const { id } = paramsSchema.parse(await params)

    const db = createTenantPrisma(session.organizationId)

    const existing = await db.assignmentRule.findFirst({ where: { id } })
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Assignment rule not found', 404)
    }

    await db.assignmentRule.delete({ where: { id } })

    return NextResponse.json({ data: { id, deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
