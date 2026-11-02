import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { readWebsiteBody } from './website-receptionist-http'
export async function outcomeResponse(action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>) {
  try { const session = await requireSession(); return NextResponse.json({ data: await action(session) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Choose valid callback outcome values.', 400) : new AppError('OUTCOME_UNAVAILABLE', 'Callback outcome is unavailable. Reload or retry the same confirmation.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response
  }
}
export async function readOutcomeBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to review and confirm callback outcomes.', 403)
  return readWebsiteBody(request)
}
export function readOutcomeQuery(request: Request) {
  const query = new URL(request.url).searchParams
  if (query.toString().length > 256 || [...query.keys()].some(key => query.getAll(key).length !== 1)) throw new AppError('VALIDATION_ERROR', 'Use one valid filter, page or history cursor.', 400)
  return Object.fromEntries(query)
}
