import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { createTenantPrisma } from '@/server/db/middleware'
import { disconnectGmail } from '@/server/services/email'
import { disconnectMicrosoft } from '@/server/services/microsoft-email'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/email/account?provider=gmail|microsoft — Returns the caller's
 * connected mailbox for that provider, or `null`. Defaults to `gmail` for
 * backward compatibility with the existing Gmail connector.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession()
    const provider = request.nextUrl.searchParams.get('provider') ?? 'gmail'

    const db = createTenantPrisma(session.organizationId)
    const account = await db.emailAccount.findFirst({
      where: { userId: session.dbUser.id, provider },
      select: { id: true, email: true, lastSyncAt: true, provider: true },
    })

    return NextResponse.json({ data: account })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * DELETE /api/email/account?provider=gmail|microsoft — Disconnects the
 * caller's mailbox for that provider. Gmail revokes the refresh token at
 * Google; Microsoft just removes the stored record. Idempotent.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession()
    const provider = request.nextUrl.searchParams.get('provider') ?? 'gmail'

    const result =
      provider === 'microsoft'
        ? await disconnectMicrosoft(session.dbUser.id, session.organizationId)
        : await disconnectGmail(session.dbUser.id, session.organizationId)

    return NextResponse.json({ data: result })
  } catch (err) {
    return errorResponse(err)
  }
}
