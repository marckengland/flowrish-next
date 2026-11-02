import { NextRequest, NextResponse } from 'next/server'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { previewReceptionist } from '@/server/services/receptionist-preview'

const MAX_BODY_BYTES = 64 * 1024

async function readPreviewBody(request: NextRequest): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 'Preview input is too large. Start a new preview.', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new AppError('VALIDATION_ERROR', 'Send a JSON object to start a preview.', 400)
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new AppError('PAYLOAD_TOO_LARGE', 'Preview input is too large. Start a new preview.', 413)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try { return JSON.parse(text) }
  catch { throw new AppError('VALIDATION_ERROR', 'Send valid JSON to start a preview.', 400) }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    const input = await readPreviewBody(request)
    const data = await previewReceptionist(session.organizationId, session.dbUser.id, input)
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
