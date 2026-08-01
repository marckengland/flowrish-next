import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { requireEntitlement } from '@/server/auth/entitlements'
import { calculatePipelineMetrics, calculateWinRate } from '@/server/services/forecast'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/forecast — Returns pipeline metrics and win rate.
 *
 * Response: { data: { totalPipeline, weightedPipeline, aiPredicted, winRate } }
 *
 * Validates: Requirements 10.1, 10.5
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'forecast:read')
    await requireEntitlement(session.organizationId, 'forecasting')

    const metrics = await calculatePipelineMetrics(session.organizationId)
    const winRate = await calculateWinRate(session.organizationId)

    return NextResponse.json({
      data: {
        ...metrics,
        winRate,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
