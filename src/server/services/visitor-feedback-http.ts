import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
export async function feedbackResponse(action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>) {
  try { const session = await requireSession(); return NextResponse.json({ data: await action(session) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Check the feedback request and current version.', 400) : new AppError('FEEDBACK_UNAVAILABLE', 'Visitor feedback is unavailable. Reload and try again.', 503); const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response }
}
