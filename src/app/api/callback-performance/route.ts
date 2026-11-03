import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { defaultPerformanceDates, performanceQuerySchema } from '@/lib/callback-performance'
import { requireSession } from '@/server/auth/session'
import { getCallbackPerformance } from '@/server/services/callback-performance'

export async function GET(request: Request) {
  try {
    const session = await requireSession(), params = new URL(request.url).searchParams
    if (params.toString().length > 256 || [...params.keys()].some(key => params.getAll(key).length !== 1)) throw new AppError('VALIDATION_ERROR', 'Use one value per performance filter.', 400)
    const query = performanceQuerySchema.parse({ ...defaultPerformanceDates(), ...Object.fromEntries(params) })
    return NextResponse.json({ data: await getCallbackPerformance(session.organizationId, session.dbUser.id, query) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Choose valid UTC dates, an owner and a report view.', 400) : new AppError('PERFORMANCE_UNAVAILABLE', 'Receptionist performance is unavailable. Refresh and try again.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response
  }
}
