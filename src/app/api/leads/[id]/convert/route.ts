import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadAccessFilter } from '@/server/services/access'
import { revalidatePath } from 'next/cache'
import { convertToContact } from '@/server/services/leads'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid lead ID'),
})

/**
 * POST /api/leads/[id]/convert — Convert a lead to a contact.
 *
 * - Creates a Contact record from lead data
 * - Moves the lead to the "Closed Won" stage
 * - Links the contact to the lead via LeadContact
 * - Exits all active cadence enrollments with reason "lead_converted"
 *
 * Validates: Requirements 29.1, 29.2, 29.3, 29.4
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const { id } = paramsSchema.parse(await params)

    const access = await getLeadAccessFilter(session.dbUser, session.organizationId)
    const result = await convertToContact(id, session.dbUser.id, session.organizationId, { ...access })
    for (const path of ['/leads', `/leads/${id}`, '/contacts', '/pipeline', '/forecast', '/dashboard']) revalidatePath(path)

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
