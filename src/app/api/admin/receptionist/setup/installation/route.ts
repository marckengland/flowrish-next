import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { installationInputSchema } from '@/lib/receptionist-installation'
import { requireSession } from '@/server/auth/session'
import { checkReceptionistInstallation } from '@/server/services/receptionist-installation'
import { readSetupBody } from '@/server/services/receptionist-setup-http'

export const runtime = 'nodejs'
export const maxDuration = 20
export async function POST(request: Request) {
  try {
    const session = await requireSession(), input = installationInputSchema.parse(await readSetupBody(request))
    return NextResponse.json({ data: await checkReceptionistInstallation(session.organizationId, session.dbUser.id, input, new URL(request.url).origin, request.signal) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Use a public HTTPS page URL and the current saved website settings.', 400) : new AppError('INSTALLATION_UNAVAILABLE', 'Website installation check is unavailable. Try again later.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); if (safe.statusCode === 429) response.headers.set('Retry-After', '30'); return response
  }
}
