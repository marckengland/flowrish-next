import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { createTenantPrisma } from '@/server/db/middleware'
import { disconnectGmail } from '@/server/services/email'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/email/account — Returns the authenticated user's connected
 * Gmail account, or `null` if they haven't connected one yet.
 *
 * Used by the Settings page to render the correct connected/disconnected
 * state on first paint and after the OAuth popup completes.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireSession()

    const db = createTenantPrisma(session.organizationId)
    const account = await db.emailAccount.findFirst({
      where: { userId: session.dbUser.id, provider: 'gmail' },
      select: { id: true, email: true },
    })

    return NextResponse.json({ data: account })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * DELETE /api/email/account — Disconnects the authenticated user's
 * Gmail account. Revokes the refresh token at Google (best effort) and
 * deletes the local EmailAccount row.
 *
 * Idempotent: returns `{ disconnected: false }` if there was no
 * connected account in the first place.
 */
export async function DELETE(): Promise<NextResponse> {
  try {
    const session = await requireSession()

    const result = await disconnectGmail(
      session.dbUser.id,
      session.organizationId,
    )

    return NextResponse.json({ data: result })
  } catch (err) {
    return errorResponse(err)
  }
}
