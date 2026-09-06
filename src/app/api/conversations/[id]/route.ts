import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requireEntitlement } from '@/server/auth/entitlements'
import {
  getConversation,
  renameConversation,
  deleteConversation,
} from '@/server/services/conversations'
import { conversationRenameSchema } from '@/lib/validators/conversations'
import { errorResponse } from '@/lib/errors'

const paramsSchema = z.object({
  id: z.string().uuid('Invalid conversation ID'),
})

/**
 * GET /api/conversations/[id] — Fetch one conversation with its messages
 * (ordered oldest→newest). 404 if it isn't the caller's.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const { id } = paramsSchema.parse(await params)
    const conversation = await getConversation(
      id,
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: conversation })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/conversations/[id] — Rename a conversation.
 *
 * Body: { title }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const { id } = paramsSchema.parse(await params)
    const body = await request.json()
    const { title } = conversationRenameSchema.parse(body)

    const conversation = await renameConversation(
      id,
      title,
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: conversation })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/conversations/[id] — Delete a conversation and its messages.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const { id } = paramsSchema.parse(await params)
    const result = await deleteConversation(
      id,
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: result })
  } catch (error) {
    return errorResponse(error)
  }
}
