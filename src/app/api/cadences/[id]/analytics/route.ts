import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse, AppError } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid cadence ID'),
})

/**
 * GET /api/cadences/[id]/analytics — Get cadence analytics.
 *
 * Returns total enrollments, active/completed/exited/paused counts,
 * and completion rate.
 *
 * Validates: Requirements 32.1, 32.4
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

    // Verify cadence exists
    const cadence = await db.cadence.findFirst({ where: { id } })
    if (!cadence) {
      throw new AppError('NOT_FOUND', 'Cadence not found', 404)
    }

    // Get enrollment counts grouped by status
    const [total, active, completed, exited, paused] = await Promise.all([
      db.cadenceEnrollment.count({ where: { cadenceId: id } }),
      db.cadenceEnrollment.count({ where: { cadenceId: id, status: 'ACTIVE' } }),
      db.cadenceEnrollment.count({ where: { cadenceId: id, status: 'COMPLETED' } }),
      db.cadenceEnrollment.count({ where: { cadenceId: id, status: 'EXITED' } }),
      db.cadenceEnrollment.count({ where: { cadenceId: id, status: 'PAUSED' } }),
    ])

    // Completion rate: completed / (completed + exited) — only terminal states
    const terminalCount = completed + exited
    const completionRate = terminalCount > 0
      ? Math.round((completed / terminalCount) * 100)
      : 0

    return NextResponse.json({
      data: {
        cadenceId: id,
        cadenceName: (cadence as { name: string }).name,
        cadenceStatus: (cadence as { status: string }).status,
        totalEnrollments: total,
        activeEnrollments: active,
        completedEnrollments: completed,
        exitedEnrollments: exited,
        pausedEnrollments: paused,
        completionRate,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
