import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requireEntitlement } from '@/server/auth/entitlements'
import { getLatestConversation } from '@/server/services/conversations'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/conversations/latest — The user's most recent conversation
 * with its messages, or `{ data: null }` when they have none. Backs the
 * "restore my thread after a refresh" flow.
 *
 * A literal `latest` segment never collides with the `[id]` route since
 * conversation ids are uuids.
 */
export async function GET() {
  try {
    const session = await requireSession()
    await requireEntitlement(session.organizationId, 'ai')

    const conversation = await getLatestConversation(
      session.dbUser.id,
      session.organizationId,
    )
    return NextResponse.json({ data: conversation })
  } catch (error) {
    return errorResponse(error)
  }
}
