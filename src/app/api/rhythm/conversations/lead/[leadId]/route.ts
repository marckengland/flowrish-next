import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getLeadConversations } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  leadId: z.string().uuid('Invalid lead ID'),
})

/**
 * GET /api/rhythm/conversations/lead/[leadId] — Lead conversation history.
 *
 * Returns all meeting/call summaries for a lead, sorted by createdAt descending.
 * Includes AI summaries (if previously generated), key topics, action items,
 * sentiment, and tracker keyword matches.
 *
 * Validates: Requirements 31.1, 31.3
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { leadId } = paramsSchema.parse(await params)

    const conversations = await getLeadConversations(leadId, session.organizationId)

    return NextResponse.json({ data: conversations })
  } catch (error) {
    return errorResponse(error)
  }
}
