import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/errors'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { requireEntitlement } from '@/server/auth/entitlements'
import { getForecastHistory } from '@/server/services/forecast-history'

/** Read-only, fixed six-month window for the authenticated user's results. */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'forecast:read')
    await requireEntitlement(session.organizationId, 'forecasting')
    return NextResponse.json({ data: await getForecastHistory(session.organizationId, session.dbUser.id) })
  } catch (error) {
    return errorResponse(error)
  }
}
