import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { generateEmail } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'

const generateEmailBodySchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
})

/**
 * POST /api/ai/generate-email — Generate an AI-drafted email for a lead.
 *
 * Body: { leadId }
 *
 * Validates: Requirements 8.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const body = await request.json()
    const { leadId } = generateEmailBodySchema.parse(body)

    const result = await generateEmail(
      leadId,
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
