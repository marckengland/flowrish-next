import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { getReceptionistReadiness } from '@/server/services/receptionist-preview'

export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'admin:settings')
    const data = await getReceptionistReadiness(session.organizationId, session.dbUser.id)
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
