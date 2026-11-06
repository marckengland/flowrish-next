import 'server-only'
import type { FollowUpPageMeta } from '@/lib/follow-up-page'
import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { AppError, errorResponse } from '@/lib/errors'
import { FOLLOW_UP_SCOPE_HEADER } from '@/lib/follow-up-access'
import { WORKSPACE_HEADER } from '@/lib/workspace-context'
export function assertFollowUpContext(request: Request, session: Awaited<ReturnType<typeof requireSession>>) {
  if (request.headers.get(FOLLOW_UP_SCOPE_HEADER) !== JSON.stringify([session.organizationId, session.dbUser.id]) || request.headers.get(WORKSPACE_HEADER) !== session.organizationId) throw new AppError('FOLLOW_UP_CONTEXT_CHANGED', 'The account or business changed. Reload before continuing.', 409)
}
export async function followUpHttp(request: Request, write: boolean, action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<{ data: unknown; canWrite: boolean; taskProgress?: boolean; taskOrder?: boolean; page?: FollowUpPageMeta }>) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    if (write) requirePermission(session.dbUser, 'leads:write')
    assertFollowUpContext(request, session)
    const result = await action(session)
    return NextResponse.json({ data: result.data, ...(result.page ? { page: result.page } : {}), scope: { organizationId: session.organizationId, userId: session.dbUser.id }, capabilities: { canWrite: result.canWrite, ...(result.taskProgress ? { taskProgress: true } : {}), ...(result.taskOrder ? { taskOrder: true } : {}) } }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Send valid follow-up values.', 400) : new AppError('FOLLOW_UP_UNAVAILABLE', 'Follow-ups are unavailable. Refresh or retry the same action.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'private, no-store'); return response
  }
}
export const followUpId = (id: string) => z.string().min(1).max(128).parse(id)
export function assertFollowUpOrigin(request: Request) { if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to update follow-ups or send email.', 403) }
export async function followUpBody(request: Request): Promise<unknown> {
  assertFollowUpOrigin(request)
  const invalid = () => new AppError('VALIDATION_ERROR', 'Send valid follow-up JSON.', 400), tooLarge = () => new AppError('PAYLOAD_TOO_LARGE', 'This follow-up request is too large.', 413)
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw invalid()
  if (Number(request.headers.get('content-length')) > 65536) throw tooLarge()
  const reader = request.body?.getReader(); if (!reader) throw invalid()
  const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = ''
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 65536) { await reader.cancel(); throw tooLarge() }; text += decoder.decode(value, { stream: true }) }; return JSON.parse(text + decoder.decode()) as unknown }
  catch (error) { if (error instanceof AppError) throw error; throw invalid() }
  finally { reader.releaseLock() }
}
