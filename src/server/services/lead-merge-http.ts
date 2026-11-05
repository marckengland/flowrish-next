import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { MERGE_USER_HEADER } from '@/lib/lead-merge'

export async function leadMergeHttp(request: Request, action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>, merge = true) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    if (merge) { requirePermission(session.dbUser, 'leads:write'); requirePermission(session.dbUser, 'leads:delete') }
    const expectedUser = request.headers.get(MERGE_USER_HEADER)
    // An equality fence for stale tabs, never an ownership or authorization source.
    if (expectedUser !== session.dbUser.id) throw new AppError('MERGE_CONTEXT_CHANGED', 'The account changed. Reload before continuing.', 409)
    return NextResponse.json({ data: await action(session), scope: { organizationId: session.organizationId, userId: session.dbUser.id } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : error instanceof ZodError ? new AppError('VALIDATION_ERROR', 'Choose two valid leads and review the merge.', 400) : new AppError('MERGE_UNAVAILABLE', 'Could not confirm this merge. Retry the same confirmed request before starting another.', 503)
    const response = errorResponse(safe)
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
}
export async function leadMergeBody(request: Request): Promise<unknown> {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new AppError('FORBIDDEN', 'Use Flowrish to review lead merges.', 403)
  const invalid = () => new AppError('VALIDATION_ERROR', 'Send valid JSON for this lead update.', 400)
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw invalid()
  const max = 16384, tooLarge = () => new AppError('PAYLOAD_TOO_LARGE', 'This merge request is too large.', 413)
  if (Number(request.headers.get('content-length')) > max) throw tooLarge()
  const reader = request.body?.getReader()
  if (!reader) throw invalid()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, text = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > max) { await reader.cancel(); throw tooLarge() }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch (error) { if (error instanceof AppError) throw error; throw invalid() }
  finally { reader.releaseLock() }
}
