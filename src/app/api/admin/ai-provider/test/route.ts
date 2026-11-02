import { NextRequest, NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { testAiProviderSettings } from '@/server/services/org-ai-provider'

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    let input: unknown
    try { input = await request.json() } catch { throw new AppError('VALIDATION_ERROR', 'Enter a saved AI settings version.', 400) }
    const { expectedUpdatedAt } = z.object({ expectedUpdatedAt: z.string().datetime() }).strict().parse(input)
    return NextResponse.json({ data: await testAiProviderSettings(session.dbUser.id, session.organizationId, expectedUpdatedAt) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error instanceof AppError || error instanceof ZodError ? error : new AppError('AI_SETTINGS_ERROR', 'The AI connection test could not be completed.', 500))
  }
}
