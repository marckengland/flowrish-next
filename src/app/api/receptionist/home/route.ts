import { NextResponse } from 'next/server'
import { AppError, errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { getReceptionistHome } from '@/server/services/receptionist-home'
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    if (new URL(request.url).search) throw new AppError('VALIDATION_ERROR', 'Receptionist home uses the current organization and does not accept filters.', 400)
    return NextResponse.json({ data: await getReceptionistHome(session.organizationId, session.dbUser.id) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof AppError ? error : new AppError('RECEPTIONIST_HOME_UNAVAILABLE', 'Receptionist home is unavailable. Refresh and try again.', 503)
    const response = errorResponse(safe); response.headers.set('Cache-Control', 'no-store'); return response
  }
}
