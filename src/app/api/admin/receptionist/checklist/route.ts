import { NextResponse } from 'next/server'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { getReceptionistChecklist } from '@/server/services/receptionist-checklist'

export async function GET() {
  try {
    const session = await requireSession()
    const data = await getReceptionistChecklist(session.organizationId, session.dbUser.id)
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error instanceof AppError ? error : new AppError('READINESS_UNAVAILABLE', 'Saved receptionist setup could not be checked.', 503))
  }
}
