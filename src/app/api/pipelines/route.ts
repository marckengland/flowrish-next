import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/pipelines — Lists every pipeline in the caller's organization
 * along with its stages (ordered ascending).
 *
 * Today the system only ever creates a single "Sales Pipeline" per
 * organization, but the schema models a 1:N relationship and several
 * UI surfaces (PipelineSelector, KanbanBoard) iterate over the list,
 * so we return an array rather than a single pipeline object.
 *
 * Stages include the terminal-state flags so the client can render
 * lock indicators for closed stages without a separate fetch.
 *
 * Validates: Requirements 4.5, 17.2
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const db = createTenantPrisma(session.organizationId)
    const pipelines = await db.pipeline.findMany({
      include: {
        stages: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            name: true,
            order: true,
            isClosedWon: true,
            isClosedLost: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ data: pipelines })
  } catch (error) {
    return errorResponse(error)
  }
}
