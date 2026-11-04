import { forecastBasis } from '@/lib/forecast-basis'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { AppError } from '@/lib/errors'
import { FORECAST_CURRENCY, MAX_MONEY_AMOUNT } from '@/lib/money'

/**
 * Revenue Forecasting Service
 *
 * Provides pipeline metrics calculation, forecast submission,
 * risk assessment, and win rate calculation.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.5
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineMetrics {
  totalPipeline: number
  weightedPipeline: number
  aiPredicted: number
}

export type ForecastRisk = 'On Track' | 'At Risk' | 'High Risk'

// ─── Pipeline Metrics ────────────────────────────────────────────────────────

/**
 * Calculates pipeline metrics for an organization:
 * - Total pipeline: sum of dealValue for all open leads (isClosed=false, deletedAt=null)
 * - Weighted pipeline: sum of (dealValue × stage win probability)
 *   where win probability = stage.order / total stages in pipeline
 * - AI predicted: 0.7 × weighted + 0.3 × monthly run rate
 *   (monthly run rate = closedWon value in last 30 days)
 *
 * Validates: Requirement 10.1
 */
export async function calculatePipelineMetrics(
  orgId: string,
  ownerUserId?: string,
): Promise<PipelineMetrics> {
  const db = createTenantPrisma(orgId)

  // Fetch all open leads with their stage and pipeline info
  const openLeads = await db.lead.findMany({
    where: {
      isClosed: false,
      deletedAt: null,
      currency: FORECAST_CURRENCY,
      ...(ownerUserId ? { assignedUserId: ownerUserId } : {}),
      stage: { isClosedWon: false, isClosedLost: false },
    },
    include: {
      stage: {
        include: {
          pipeline: {
            include: {
              stages: true,
            },
          },
        },
      },
    },
  })

  // Calculate total pipeline value
  let totalPipeline = 0
  let weightedPipeline = 0

  for (const lead of openLeads) {
    const dealValue = lead.dealValue ? Number(lead.dealValue) : 0
    totalPipeline += dealValue

    // Win probability = stage.order / total stages in pipeline
    if (lead.stage && lead.stage.pipeline) {
      const totalStages = lead.stage.pipeline.stages.length
      const winProbability = totalStages > 0 ? Math.min(1, Math.max(0, lead.stage.order / totalStages)) : 0
      weightedPipeline += dealValue * winProbability
    }
  }

  // Calculate monthly run rate (closedWon value in last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const closedWonLeads = await db.lead.findMany({
    where: {
      isClosed: true,
      deletedAt: null,
      closeDate: { gte: thirtyDaysAgo },
      stage: { isClosedWon: true },
      currency: FORECAST_CURRENCY,
      ...(ownerUserId ? { assignedUserId: ownerUserId } : {}),
    },
  })

  let monthlyRunRate = 0
  for (const lead of closedWonLeads) {
    monthlyRunRate += lead.dealValue ? Number(lead.dealValue) : 0
  }

  // AI predicted: 70% weighted + 30% monthly run rate
  const aiPredicted = 0.7 * weightedPipeline + 0.3 * monthlyRunRate

  return {
    totalPipeline,
    weightedPipeline,
    aiPredicted,
  }
}

// ─── Forecast Submission ─────────────────────────────────────────────────────

/**
 * Submits a forecast commit for a specific period.
 * Stores the commit amount for the YYYY-MM period.
 *
 * Validates: Requirement 10.2
 */
export async function submitForecast(
  userId: string,
  orgId: string,
  period: string,
  commitAmount: number,
  notes?: string,
): Promise<{ id: string }> {
  // Validate period format (YYYY-MM)
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) {
    throw new AppError('INVALID_PERIOD', 'Period must be in YYYY-MM format', 400)
  }

  if (!Number.isFinite(commitAmount) || commitAmount < 0 || commitAmount > MAX_MONEY_AMOUNT) {
    throw new AppError('INVALID_AMOUNT', 'Commit amount must be finite, non-negative and within the supported range', 400)
  }

  const db = createTenantPrisma(orgId)

  const submission = await db.forecastSubmission.create({
    data: tenantData({
      userId,
      period,
      commitAmount,
      notes: notes ?? null,
      ...forecastBasis('OWNER'),
    }),
  })

  return { id: submission.id }
}

// ─── Forecast Risk Assessment ────────────────────────────────────────────────

/**
 * Assesses forecast risk by comparing team commit vs AI predicted.
 * Gap = |teamCommit - aiPredicted| / aiPredicted × 100
 *
 * - On Track: gap < 15%
 * - At Risk: gap 15-30%
 * - High Risk: gap > 30%
 *
 * Validates: Requirement 10.3
 */
export function assessForecastRisk(
  teamCommit: number,
  aiPredicted: number,
): ForecastRisk {
  // If aiPredicted is 0, we can't calculate a meaningful gap
  if (aiPredicted === 0) {
    // If both are 0, consider it on track; otherwise high risk
    return teamCommit === 0 ? 'On Track' : 'High Risk'
  }

  const gap = (Math.abs(teamCommit - aiPredicted) / aiPredicted) * 100

  if (gap < 15) {
    return 'On Track'
  } else if (gap <= 30) {
    return 'At Risk'
  } else {
    return 'High Risk'
  }
}

// ─── Win Rate Calculation ────────────────────────────────────────────────────

/**
 * Calculates historical win rate from the last 90 days of closed deals.
 * Win rate = closedWon count / (closedWon + closedLost count), capped at 100%.
 *
 * Returns a percentage value (0-100).
 *
 * Validates: Requirement 10.5
 */
export async function calculateWinRate(orgId: string): Promise<number> {
  const db = createTenantPrisma(orgId)

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  // Count closed won leads in last 90 days
  const closedWonCount = await db.lead.count({
    where: {
      isClosed: true,
      deletedAt: null,
      closeDate: { gte: ninetyDaysAgo },
      stage: { isClosedWon: true },
    },
  })

  // Count closed lost leads in last 90 days
  const closedLostCount = await db.lead.count({
    where: {
      isClosed: true,
      deletedAt: null,
      closeDate: { gte: ninetyDaysAgo },
      stage: { isClosedLost: true },
    },
  })

  const totalClosed = closedWonCount + closedLostCount

  if (totalClosed === 0) {
    return 0
  }

  const winRate = (closedWonCount / totalClosed) * 100

  // Cap at 100%
  return Math.min(winRate, 100)
}
