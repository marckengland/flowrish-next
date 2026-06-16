import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { connectGmail } from '@/server/services/email'
import { errorResponse } from '@/lib/errors'

const connectBodySchema = z.object({
  code: z.string().min(1, 'OAuth authorization code is required'),
  redirectUri: z
    .string()
    .url('redirectUri must be a valid URL')
    .optional(),
})

/**
 * POST /api/email/connect — Exchange Gmail OAuth code for tokens and store encrypted.
 *
 * Body: { code, redirectUri? }
 *
 * `redirectUri` should be the exact value sent in the initial OAuth
 * request. When omitted, we derive it from this request's origin —
 * which works for same-origin browser fetches but not for direct API
 * usage. Always prefer to pass it explicitly.
 *
 * Validates: Requirements 7.1
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')

    const body = await request.json()
    const { code, redirectUri } = connectBodySchema.parse(body)

    const resolvedRedirectUri =
      redirectUri ?? `${request.nextUrl.origin}/api/email/callback`

    const result = await connectGmail(
      code,
      session.dbUser.id,
      session.organizationId,
      resolvedRedirectUri,
    )

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
