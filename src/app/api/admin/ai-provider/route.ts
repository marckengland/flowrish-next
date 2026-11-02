import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { getAiProviderSettings, saveAiProviderSettings } from '@/server/services/org-ai-provider'

function routeError(error: unknown) {
  return errorResponse(error instanceof AppError || error instanceof ZodError ? error : new AppError('AI_SETTINGS_ERROR', 'AI settings could not be loaded or saved.', 500))
}

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ data: await getAiProviderSettings(session.dbUser.id, session.organizationId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return routeError(error) }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireSession()
    let input: unknown
    try { input = await request.json() } catch { throw new AppError('VALIDATION_ERROR', 'Enter valid AI settings.', 400) }
    return NextResponse.json({ data: await saveAiProviderSettings(session.dbUser.id, session.organizationId, input) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return routeError(error) }
}
