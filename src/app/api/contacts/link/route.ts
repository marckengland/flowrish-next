import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import {
  linkContactToLead,
  unlinkContactFromLead,
} from '@/server/services/contacts'
import { errorResponse } from '@/lib/errors'

const linkBodySchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
  contactId: z.string().uuid('Invalid contact ID'),
})

/**
 * POST /api/contacts/link — Associate a contact with a lead.
 *
 * Body: `{ leadId, contactId }`. Idempotent — re-linking an already
 * linked pair returns success without creating a duplicate row.
 *
 * Validates: Requirement 19.4
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { leadId, contactId } = linkBodySchema.parse(body)

    const link = await linkContactToLead(
      contactId,
      leadId,
      session.organizationId,
    )

    return NextResponse.json({ data: link })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/contacts/link — Remove the association between a lead
 * and a contact, leaving both records intact.
 *
 * Body: `{ leadId, contactId }`. Idempotent — unlinking a pair that
 * isn't linked returns success.
 *
 * Validates: Requirement 19.4
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { leadId, contactId } = linkBodySchema.parse(body)

    await unlinkContactFromLead(
      contactId,
      leadId,
      session.organizationId,
    )

    return NextResponse.json({ data: { leadId, contactId, unlinked: true } })
  } catch (error) {
    return errorResponse(error)
  }
}
