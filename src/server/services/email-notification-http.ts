import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { EMAIL_NOTIFICATION_USER_HEADER } from '@/lib/email-notifications'
import { WORKSPACE_HEADER } from '@/lib/workspace-context'
export async function emailNotificationHttp(request: Request, action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>) {
  try {
    const session = await requireSession()
    if (request.headers.get(EMAIL_NOTIFICATION_USER_HEADER) !== session.dbUser.id || request.headers.get(WORKSPACE_HEADER) !== session.organizationId) throw new AppError('EMAIL_NOTIFICATION_CONTEXT_CHANGED', 'The account or business changed. Reload before continuing.', 409)
    return NextResponse.json({ data: await action(session), scope: { organizationId: session.organizationId, userId: session.dbUser.id } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Choose valid notification values.', 400) : new AppError('EMAIL_NOTIFICATIONS_UNAVAILABLE', 'Email notifications are unavailable. Refresh or retry the same acknowledgment.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response
  }
}
export async function emailNotificationBody(request: Request): Promise<unknown> {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to update notifications.', 403)
  const invalid = () => new AppError('VALIDATION_ERROR', 'Send valid notification JSON.', 400), tooLarge = () => new AppError('PAYLOAD_TOO_LARGE', 'This acknowledgment is too large.', 413)
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw invalid()
  if (Number(request.headers.get('content-length')) > 8192) throw tooLarge()
  const reader = request.body?.getReader(); if (!reader) throw invalid()
  const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = ''
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 8192) { await reader.cancel(); throw tooLarge() }; text += decoder.decode(value, { stream: true }) }; return JSON.parse(text + decoder.decode()) as unknown }
  catch (error) { if (error instanceof AppError) throw error; throw invalid() }
  finally { reader.releaseLock() }
}
