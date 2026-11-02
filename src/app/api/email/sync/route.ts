import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession } from '@/server/auth/session'
import { hasPermission, requirePermission } from '@/server/auth/permissions'
import { listMailboxSyncHealth, requestMailboxSync } from '@/server/services/mailbox-sync'
import { AppError, errorResponse } from '@/lib/errors'

const requestSchema = z.object({ provider: z.enum(['gmail', 'microsoft']).optional() })

export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')
    return NextResponse.json({ data: await listMailboxSyncHealth(session.organizationId, session.dbUser.id), capabilities: { canWrite: hasPermission(session.dbUser, 'leads:write') } })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')
    const text = await request.text()
    let payload: unknown = {}
    if (text.trim()) {
      try { payload = JSON.parse(text) } catch { throw new AppError('VALIDATION_ERROR', 'Invalid sync request.', 400) }
    }
    const { provider } = requestSchema.parse(payload)
    return NextResponse.json({ data: await requestMailboxSync(session.organizationId, session.dbUser.id, provider) })
  } catch (error) { return errorResponse(error) }
}
