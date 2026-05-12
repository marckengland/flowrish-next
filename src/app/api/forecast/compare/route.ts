import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
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

    const db = createTenantPrisma(session.organizationId)

    // Get latest forecast submission
    const latestSubmission = await db.forecastSubmission.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        period: true,
        commitAmount: true,
        notes: true,
        createdAt: true,
      },
    })

    // Calculate AI predicted value
    const metrics = await calculatePipelineMetrics(session.organizationId)

    // Assess risk level based on commit vs AI predicted
    const commitAmount = latestSubmission
      ? Number(latestSubmission.commitAmount)
      : 0
    const riskLevel = assessForecastRisk(commitAmount, metrics.aiPredicted)

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
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        totalPipeline: true,
        weightedPipeline: true,
        aiPredicted: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      data: {
        latestSubmission,
        aiPredicted: metrics.aiPredicted,
        riskLevel,
        confidenceInterval,
        snapshots,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
