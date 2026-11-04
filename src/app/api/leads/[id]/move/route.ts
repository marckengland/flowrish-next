import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { revalidatePath } from 'next/cache'
import { moveLead } from '@/server/services/leads'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid lead ID'),
})

const moveLeadSchema = z.object({
  toStageId: z.string().uuid('Invalid stage ID'),
})

/**
 * PATCH /api/leads/[id]/move — Move a lead to a different pipeline stage.
 *
 * Body: { toStageId: string }
 *
 * - Creates a StageTransition record
 * - Sets isClosed=true and closeDate for terminal stages (isClosedWon/isClosedLost)
 * - Clears isClosed and closeDate when moving back to an open stage
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 29.4, 34.3
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { toStageId } = moveLeadSchema.parse(body)

    const access = await getLeadAccessFilter(session.dbUser, session.organizationId)
    const lead = await moveLead(id, toStageId, session.dbUser.id, session.organizationId, { ...access })
    revalidatePath('/pipeline')
    revalidatePath('/forecast')
    revalidatePath('/dashboard')
    revalidatePath('/leads')
    revalidatePath('/leads/' + id)

    return NextResponse.json({ data: lead })
  } catch (error) {
    return errorResponse(error)
  }
}
