import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { summarizeMeeting } from '@/server/services/ai'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  activityId: z.string().uuid('Invalid activity ID'),
})

/**
 * POST /api/rhythm/conversations/[activityId]/summarize — AI meeting summary.
 *
 * Generates an AI-powered summary of a meeting or call activity.
 * Idempotent: returns stored summary if already generated.
 *
 * Validates: Requirements 31.1, 31.3
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  try {
    const session = await requireSession()

    const { activityId } = paramsSchema.parse(await params)

    const summary = await summarizeMeeting(activityId, session.organizationId)

    return NextResponse.json({ data: summary })
  } catch (error) {
    return errorResponse(error)
  }
}
