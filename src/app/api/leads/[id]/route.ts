import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { getLeadById, updateLead, softDeleteLead } from '@/server/services/leads'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid lead ID'),
})

/**
 * GET /api/leads/[id] — Get lead detail with related data.
 *
 * Validates: Requirements 4.1, 4.2
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { id } = paramsSchema.parse(await params)

    const accessFilter = await getLeadAccessFilter(session.dbUser)
    const lead = await getLeadById(id, accessFilter, session.organizationId)

    return NextResponse.json({ data: lead })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/leads/[id] — Update a lead.
 *
 * Body: { ...fields to update }
 *
 * Validates: Requirements 4.2
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

    const lead = await updateLead(id, body, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: lead })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/leads/[id] — Soft-delete a lead.
 *
 * Sets deletedAt timestamp. Idempotent — does not change if already deleted.
 *
 * Validates: Requirements 4.3
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:delete')

    const { id } = paramsSchema.parse(await params)

    const lead = await softDeleteLead(id, session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: lead })
  } catch (error) {
    return errorResponse(error)
  }
}
