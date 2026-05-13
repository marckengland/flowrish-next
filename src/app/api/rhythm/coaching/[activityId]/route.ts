import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { addComment, getComments } from '@/server/services/coaching'
import { errorResponse } from '@/lib/errors'
import { z } from 'zod'

const paramsSchema = z.object({
  activityId: z.string().uuid('Invalid activity ID'),
})

const addCommentBodySchema = z.object({
  content: z.string().min(1, 'Comment content is required'),
  mentionedUserId: z.string().uuid('Invalid mentioned user ID').optional(),
})

/**
 * GET /api/rhythm/coaching/[activityId] — List coaching comments for an activity.
 *
 * Returns comments sorted by createdAt ascending with author details.
 *
 * Validates: Requirements 30.1, 31.1
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const { activityId } = paramsSchema.parse(await params)

    const comments = await getComments(activityId, session.organizationId, session.dbUser)

    return NextResponse.json({ data: comments })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/rhythm/coaching/[activityId] — Add a coaching comment to an activity.
 *
 * Body: { content: string, mentionedUserId?: string }
 *
 * Validates: Requirements 30.1, 31.1, 31.3
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ activityId: string }> },
) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const { activityId } = paramsSchema.parse(await params)
    const body = addCommentBodySchema.parse(await request.json())

    const comment = await addComment(
      activityId,
      session.dbUser.id,
      body.content,
      body.mentionedUserId,
      session.organizationId,
    )

    return NextResponse.json({ data: comment }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
