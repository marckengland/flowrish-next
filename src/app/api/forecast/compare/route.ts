import { forecastBasisStatus } from '@/lib/forecast-basis'
import { serializeForecastSnapshot } from '@/server/services/forecast-history'
import { forecastPeriod } from '@/lib/forecast-period'
import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { requireEntitlement } from '@/server/auth/entitlements'
import {
  calculatePipelineMetrics,
  assessForecastRisk,
} from '@/server/services/forecast'
import { createTenantPrisma } from '@/server/db/middleware'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/forecast/compare — Compare team commit vs AI predicted.
 *
 * Returns the latest forecast submission, AI predicted value,
 * risk level, confidence interval, and recent pipeline snapshots.
 *
 * Response: {
 *   data: {
 *     latestSubmission: { id, period, commitAmount, notes, createdAt } | null,
 *     aiPredicted: number,
 *     riskLevel: "On Track" | "At Risk" | "High Risk",
 *     confidenceInterval: { low: number, high: number },
 *     snapshots: Array<{ id, totalPipeline, weightedPipeline, aiPredicted, createdAt }>
 *   }
 * }
 *
 * Validates: Requirement 10.3
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'forecast:read')
    await requireEntitlement(session.organizationId, 'forecasting')

    const db = createTenantPrisma(session.organizationId)

    const period = forecastPeriod()
    // Compare the same user and period as the forecast page.
    const latestSubmission = await db.forecastSubmission.findFirst({
      where: { userId: session.dbUser.id, period },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        period: true,
        commitAmount: true,
        notes: true,
        createdAt: true,
        currency: true,
        reportingTimezone: true,
        calculationVersion: true,
        scope: true,
      },
    })

    // Calculate AI predicted value
    const metrics = await calculatePipelineMetrics(session.organizationId, session.dbUser.id)

    // Assess risk level based on commit vs AI predicted
    const commitAmount = latestSubmission
      ? Number(latestSubmission.commitAmount)
      : 0
    const submissionBasisStatus = latestSubmission ? forecastBasisStatus(latestSubmission, 'OWNER') : 'missing'
    const riskLevel = submissionBasisStatus === 'verified' ? assessForecastRisk(commitAmount, metrics.aiPredicted) : null

    // Calculate confidence interval (±15% of AI predicted)
    const confidenceInterval = {
      low: metrics.aiPredicted * 0.85,
      high: metrics.aiPredicted * 1.15,
    }

    // Get recent pipeline snapshots for trend tracking (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const snapshots = await db.forecastSnapshot.findMany({
      where: {
        snapshotDate: { gte: thirtyDaysAgo },
      },
      orderBy: { snapshotDate: 'asc' },
      select: {
        id: true,
        period: true,
        currency: true,
        reportingTimezone: true,
        calculationVersion: true,
        scope: true,
        totalPipeline: true,
        weightedPipeline: true,
        aiPredicted: true,
        snapshotDate: true,
      },
    })

    return NextResponse.json({
      data: {
        latestSubmission: latestSubmission ? { ...latestSubmission, commitAmount: submissionBasisStatus === 'verified' ? latestSubmission.commitAmount : null } : null,
        currency: 'USD',
        snapshotCurrency: snapshots.length && snapshots.every(row => forecastBasisStatus(row, 'ORGANIZATION') === 'verified') ? 'USD' : 'unverified',
        reportingTimezone: 'UTC',
        scope: 'OWNER',
        submissionBasisStatus,
        aiPredicted: metrics.aiPredicted,
        riskLevel,
        confidenceInterval,
        snapshots: snapshots.map(serializeForecastSnapshot),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
