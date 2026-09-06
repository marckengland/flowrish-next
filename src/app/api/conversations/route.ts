import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requireEntitlement } from '@/server/auth/entitlements'
import { listConversations, createConversation } from '@/server/services/conversations'
import { conversationCreateSchema } from '@/lib/validators/conversations'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/conversations — List the current user's Airish conversations,
 * most-recently-updated first (summaries only, no messages).
 */
export async function GET() {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const conversations = await listConversations(
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: conversations })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/conversations — Create a new (optionally titled) conversation.
 *
 * Body: { title? }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const body = await request.json().catch(() => ({}))
    const { title } = conversationCreateSchema.parse(body)

    const conversation = await createConversation(
      session.dbUser.id,
      session.organizationId,
      title,
    )
    return NextResponse.json({ data: conversation }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
