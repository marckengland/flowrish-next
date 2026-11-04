import { NextRequest } from 'next/server'
import { z } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { startEmailOAuth } from '@/server/services/email-oauth-context'
const providerSchema = z
  .object({ provider: z.enum(['gmail', 'microsoft']) })
  .strict()
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      throw new AppError(
        'FORBIDDEN',
        'Use Flowrish to connect your mailbox.',
        403,
      )
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')
    const { provider } = providerSchema.parse(await request.json())
    return startEmailOAuth(request, session, provider)
  } catch (error) {
    const response = errorResponse(error)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
}
