import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { inngest } from '@/server/inngest/client'
import { AppError, errorResponse } from '@/lib/errors'

/**
 * POST /api/email/sync — Trigger an on-demand Gmail sync for the
 * caller's connected email account.
 *
 * The actual sync runs asynchronously inside the `email-sync` Inngest
 * function (see `src/server/inngest/email-sync.ts`). This route only
 * resolves the caller's EmailAccount and emits the `email/sync.requested`
 * event. We return immediately so the UI can show "sync started" without
 * blocking on Gmail API latency or pagination.
 *
 * Validates: Requirements 7.5
 */
export async function POST() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const db = createTenantPrisma(session.organizationId)
    const account = await db.emailAccount.findFirst({
      where: { userId: session.dbUser.id, provider: 'gmail' },
      select: { id: true },
    })

    if (!account) {
      throw new AppError(
        'NO_EMAIL_ACCOUNT',
        'No connected Gmail account. Connect Gmail before running sync.',
        400,
      )
    }

    await inngest.send({
      name: 'email/sync.requested',
      data: {
        accountId: account.id,
        organizationId: session.organizationId,
      },
    })

    return NextResponse.json({
      data: { accountId: account.id, status: 'queued' },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
