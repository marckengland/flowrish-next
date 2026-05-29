import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { generateEmail } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'

const generateEmailBodySchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
  /** Free-form description of what the email should accomplish. */
  instructions: z.string().max(2000).optional(),
  /** One of the predefined tone presets, or a custom string. */
  tone: z.string().max(200).optional(),
  /** Goal / call-to-action for the email. */
  goal: z.string().max(200).optional(),
  /**
   * When false, recent interactions are not included in the prompt.
   * Defaults to true at the service layer for backward compatibility
   * with the previous parameter-less route.
   */
  includeContext: z.boolean().optional(),
})

/**
 * POST /api/ai/generate-email — Generate an AI-drafted email for a lead.
 *
 * Body: { leadId, instructions?, tone?, goal?, includeContext? }
 *
 * Validates: Requirements 8.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const body = await request.json()
    const parsed = generateEmailBodySchema.parse(body)

    const result = await generateEmail(
      parsed.leadId,
      session.dbUser.id,
      session.organizationId,
      {
        instructions: parsed.instructions,
        tone: parsed.tone,
        goal: parsed.goal,
        includeContext: parsed.includeContext,
      },
    )

    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
