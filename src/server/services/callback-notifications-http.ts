import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { readWebsiteBody } from './website-receptionist-http'
export async function notificationResponse(action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>) {
  try { const session = await requireSession(); return NextResponse.json({ data: await action(session) }, { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Choose valid notification values.', 400) : new AppError('NOTIFICATIONS_UNAVAILABLE', 'Notifications are unavailable. Please refresh and try again.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response
  }
}
export function notificationQuery(request: Request) {
  const query = new URL(request.url).searchParams
  if (query.toString().length > 256 || [...query.keys()].some(key => query.getAll(key).length !== 1)) throw new AppError('VALIDATION_ERROR', 'Use one valid filter and page.', 400)
  return Object.fromEntries(query)
}
export async function notificationBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to update notifications.', 403)
  return readWebsiteBody(request)
}
