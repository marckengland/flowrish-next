import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { mergeLeads } from '@/server/services/duplicates'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid lead ID'),
})

const mergeBodySchema = z.object({
  secondaryLeadId: z.string().uuid('Invalid secondary lead ID'),
})

/**
 * POST /api/leads/[id]/merge — Merge a secondary lead into the primary lead.
 *
 * The [id] param is the primary lead that will retain its data.
 * Body: { secondaryLeadId } — the lead to merge into the primary.
 *
 * Moves all activities and contacts from secondary to primary (skipping
 * existing links), then deletes the secondary lead.
 *
 * Validates: Requirement 27.3
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { secondaryLeadId } = mergeBodySchema.parse(body)

    const mergedLead = await mergeLeads(id, secondaryLeadId, session.organizationId)

    return NextResponse.json({ data: mergedLead })
  } catch (error) {
    return errorResponse(error)
  }
}
