import 'server-only'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { AppError, errorResponse } from '@/lib/errors'
import { REHEARSAL_MAX_BYTES } from '@/lib/receptionist-rehearsal'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'

export async function rehearsalResponse(action: (session: Awaited<ReturnType<typeof requireSession>>) => Promise<unknown>) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    return NextResponse.json({ data: await action(session) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const response = errorResponse(error instanceof AppError || error instanceof ZodError ? error : new AppError('REHEARSAL_UNAVAILABLE', 'Rehearsal reports are unavailable. Please try again.', 503))
    response.headers.set('Cache-Control', 'no-store')
    return response
  }
}

export async function readRehearsalBody(request: Request): Promise<unknown> {
  const max = REHEARSAL_MAX_BYTES + 4096
  const tooLarge = () => new AppError('PAYLOAD_TOO_LARGE', 'This rehearsal is too large to save.', 413)
  if (Number(request.headers.get('content-length')) > max) throw tooLarge()
  const reader = request.body?.getReader()
  if (!reader) throw new AppError('VALIDATION_ERROR', 'Send a JSON object.', 400)
  const decoder = new TextDecoder()
  let bytes = 0, text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > max) { await reader.cancel(); throw tooLarge() }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally { reader.releaseLock() }
  try { return JSON.parse(text) }
  catch { throw new AppError('VALIDATION_ERROR', 'Send valid JSON.', 400) }
}
