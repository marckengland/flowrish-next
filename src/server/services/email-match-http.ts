import 'server-only'
import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { EMAIL_MATCH_USER_HEADER } from '@/lib/email-routing'
import { WORKSPACE_HEADER } from '@/lib/workspace-context'
export async function emailMatchHttp(request: Request, action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>, write = false) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    if (write) requirePermission(session.dbUser, 'leads:write')
    if (request.headers.get(EMAIL_MATCH_USER_HEADER) !== session.dbUser.id || request.headers.get(WORKSPACE_HEADER) !== session.organizationId) throw new AppError('EMAIL_MATCH_CONTEXT_CHANGED', 'The account or business changed. Reload before continuing.', 409)
    return NextResponse.json({ data: await action(session), scope: { organizationId: session.organizationId, userId: session.dbUser.id } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Review the message and confirm a valid action.', 400) : new AppError('EMAIL_MATCH_UNAVAILABLE', 'Could not confirm this update. Retry the same request before starting another.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response
  }
}
export const emailMatchId = (value: string) => z.string().uuid().parse(value)
export async function emailMatchBody(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to review email matches.', 403)
  const invalid = () => new AppError('VALIDATION_ERROR', 'Send valid JSON for this review.', 400)
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw invalid()
  const max = 8192, tooLarge = () => new AppError('PAYLOAD_TOO_LARGE', 'This review request is too large.', 413)
  if (Number(request.headers.get('content-length')) > max) throw tooLarge()
  const reader = request.body?.getReader()
  if (!reader) throw invalid()
  const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = ''
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > max) { await reader.cancel(); throw tooLarge() }; text += decoder.decode(value, { stream: true }) }
    return JSON.parse(text + decoder.decode()) as unknown
  } catch (error) { if (error instanceof AppError) throw error; throw invalid() }
  finally { reader.releaseLock() }
}
