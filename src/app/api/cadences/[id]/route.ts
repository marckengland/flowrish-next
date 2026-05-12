import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { archiveCadence } from '@/server/services/cadences'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse, AppError } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
})

const cadenceUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().nullable().optional(),
}).strict()

/**
 * GET /api/cadences/[id] — Get cadence detail with steps and enrollment count.
 *
 * Validates: Requirements 6.1, 32.1
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:read')

    const { id } = paramsSchema.parse(await params)

    const db = createTenantPrisma(session.organizationId)

    const cadence = await db.cadence.findFirst({
      where: { id },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        _count: { select: { enrollments: true } },
      },
    })

    if (!cadence) {
      throw new AppError('NOT_FOUND', 'Cadence not found', 404)
    }

    return NextResponse.json({ data: cadence })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/cadences/[id] — Update cadence name/description.
 *
 * Body: { name?, description? }
 *
 * Validates: Requirements 6.1
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const validated = cadenceUpdateSchema.parse(body)

    const db = createTenantPrisma(session.organizationId)

    const cadence = await db.cadence.findFirst({ where: { id } })
    if (!cadence) {
      throw new AppError('NOT_FOUND', 'Cadence not found', 404)
    }

    const updated = await db.cadence.update({
      where: { id },
      data: validated,
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
      },
    })

    return NextResponse.json({ data: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/cadences/[id] — Delete a cadence.
 *
 * Rejects deletion if the cadence has active enrollments.
 * Archives the cadence (exits active enrollments) then deletes related records.
 *
 * Validates: Requirements 6.1, 32.4
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'cadences:manage')

    const { id } = paramsSchema.parse(await params)

    const db = createTenantPrisma(session.organizationId)

    const cadence = await db.cadence.findFirst({
      where: { id },
      include: {
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } } as any,
          },
        },
      },
    })

    if (!cadence) {
      throw new AppError('NOT_FOUND', 'Cadence not found', 404)
    }

    // Check for active enrollments
    const activeEnrollments = await db.cadenceEnrollment.count({
      where: { cadenceId: id, status: 'ACTIVE' },
    })

    if (activeEnrollments > 0) {
      throw new AppError(
        'ACTIVE_ENROLLMENTS',
        `Cannot delete cadence with ${activeEnrollments} active enrollment(s). Archive the cadence first to exit all active enrollments.`,
        409,
      )
    }

    // Delete related records then the cadence itself
    await db.stepExecutionLog.deleteMany({
      where: { enrollment: { cadenceId: id } } as any,
    })
    await db.cadenceEnrollment.deleteMany({ where: { cadenceId: id } })
    await db.cadenceStep.deleteMany({ where: { cadenceId: id } })
    await db.cadence.delete({ where: { id } })

    return NextResponse.json({ data: { id, deleted: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
