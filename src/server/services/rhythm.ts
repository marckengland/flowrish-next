import { createTenantPrisma } from '@/server/db/middleware'
import { AppError } from '@/lib/errors'

/**
 * Rhythm Engine — Signal-Based Prioritization
 *
 * Provides priority scoring for pending actions, deal engagement scoring,
 * deal health classification, and gap identification.
 *
 * Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriorityAction {
  dueDate?: Date | string | null
  dealValue?: number | null
  leadScore?: number | null
  lastActivityAt?: Date | string | null
  priority?: 'LOW' | 'MEDIUM' | 'HIGH'
}

export type DealHealth = 'Healthy' | 'At Risk' | 'Critical'

export type DealGap =
  | 'no_recent_activity'
  | 'no_future_meeting'
  | 'single_threaded'

// ─── Priority Score Calculation ──────────────────────────────────────────────

/**
 * Calculates a priority score (1-100) for a pending action based on weighted signals.
 *
 * Signals:
 * - Overdue: +2 per hour past due, max 30
 * - Deal value: +1 per $5K, max 20
 * - Lead score: +1 per 5 points above 50, max 15
 * - Inactivity: +1 per day over 7 days since last activity, max 15
 * - HIGH priority: +10
 *
 * Final score is clamped to [1, 100].
 *
 * Validates: Requirement 9.1
 */
export function calculatePriorityScore(action: PriorityAction): number {
  let score = 0

  // Overdue signal: +2 per hour past due, max 30
  if (action.dueDate) {
    const dueDate = action.dueDate instanceof Date ? action.dueDate : new Date(action.dueDate)
    const now = new Date()
    const hoursOverdue = (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60)
    if (hoursOverdue > 0) {
      score += Math.min(Math.floor(hoursOverdue) * 2, 30)
    }
  }

  // Deal value signal: +1 per $5K, max 20
  if (action.dealValue != null && action.dealValue > 0) {
    score += Math.min(Math.floor(action.dealValue / 5000), 20)
  }

  // Lead score signal: +1 per 5 points above 50, max 15
  if (action.leadScore != null && action.leadScore > 50) {
    score += Math.min(Math.floor((action.leadScore - 50) / 5), 15)
  }

  // Inactivity signal: +1 per day over 7 days since last activity, max 15
  if (action.lastActivityAt) {
    const lastActivity = action.lastActivityAt instanceof Date
      ? action.lastActivityAt
      : new Date(action.lastActivityAt)
    const now = new Date()
    const daysSinceActivity = (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceActivity > 7) {
      score += Math.min(Math.floor(daysSinceActivity - 7), 15)
    }
  }

  // HIGH priority signal: +10
  if (action.priority === 'HIGH') {
    score += 10
  }

  // Clamp to [1, 100]
  return Math.max(1, Math.min(score, 100))
}

// ─── Deal Engagement Score ───────────────────────────────────────────────────

/**
 * Calculates a Deal Engagement Score (1-100) for a lead based on multiple factors.
 *
 * Factors:
 * - Activity Recency (0-25): based on days since last activity (0 days = 25, 30+ days = 0)
 * - Stakeholder Count (0-20): number of linked contacts (5+ = 20)
 * - Activity Volume (0-20): total activities in last 30 days (10+ = 20)
 * - Deal Progression (0-20): based on stage position in pipeline
 * - Lead Score (0-15): lead.score / 100 × 15
 *
 * Final score is clamped to [1, 100].
 *
 * Validates: Requirement 9.4
 */
export async function calculateDealEngagementScore(
  leadId: string,
  orgId: string,
): Promise<number> {
  const db = createTenantPrisma(orgId)

  // Fetch lead with stage and pipeline info
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    include: {
      stage: {
        include: {
          pipeline: {
            include: {
              stages: {
                orderBy: { order: 'asc' },
                select: { id: true, order: true },
              },
            },
          },
        },
      },
    },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  const now = new Date()
  let score = 0

  // Activity Recency (0-25): 0 days = 25, 30+ days = 0
  if (lead.lastActivityAt) {
    const daysSinceActivity = (now.getTime() - lead.lastActivityAt.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceActivity <= 0) {
      score += 25
    } else if (daysSinceActivity >= 30) {
      score += 0
    } else {
      // Linear interpolation: 25 at 0 days, 0 at 30 days
      score += Math.round(25 * (1 - daysSinceActivity / 30))
    }
  }
  // If no lastActivityAt, recency contributes 0

  // Stakeholder Count (0-20): number of linked contacts (5+ = 20)
  const contactCount = await db.leadContact.count({
    where: { leadId },
  })
  score += Math.min(Math.floor(contactCount * (20 / 5)), 20)

  // Activity Volume (0-20): total activities in last 30 days (10+ = 20)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const activityCount = await db.activity.count({
    where: {
      leadId,
      createdAt: { gte: thirtyDaysAgo },
    },
  })
  score += Math.min(Math.floor(activityCount * (20 / 10)), 20)

  // Deal Progression (0-20): based on stage position in pipeline
  const stages = lead.stage.pipeline.stages
  if (stages.length > 1) {
    const currentStageIndex = stages.findIndex((s) => s.id === lead.stageId)
    // Position ratio: 0 for first stage, 1 for last stage
    const progressionRatio = currentStageIndex / (stages.length - 1)
    score += Math.round(progressionRatio * 20)
  }
  // If only 1 stage, progression contributes 0

  // Lead Score (0-15): lead.score / 100 × 15
  score += Math.round((lead.score / 100) * 15)

  // Clamp to [1, 100]
  return Math.max(1, Math.min(score, 100))
}

// ─── Deal Health Classification ──────────────────────────────────────────────

/**
 * Classifies deal health based on engagement score.
 *
 * - Healthy: score >= 60
 * - At Risk: score 35-59
 * - Critical: score < 35
 *
 * Validates: Requirement 9.5
 */
export function classifyDealHealth(score: number): DealHealth {
  if (score >= 60) return 'Healthy'
  if (score >= 35) return 'At Risk'
  return 'Critical'
}

// ─── Deal Gap Identification ─────────────────────────────────────────────────

/**
 * Identifies gaps in deal engagement for a lead.
 *
 * Gaps:
 * - "no_recent_activity": no activity in 7+ days
 * - "no_future_meeting": no meeting with meetingDate > now
 * - "single_threaded": ≤1 contact linked — BUT skip if there's both a future meeting AND recent activity
 *
 * Validates: Requirement 9.6
 */
export async function identifyDealGaps(
  leadId: string,
  orgId: string,
): Promise<DealGap[]> {
  const db = createTenantPrisma(orgId)

  // Fetch lead
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const gaps: DealGap[] = []

  // Check for no recent activity (7+ days)
  const hasRecentActivity = lead.lastActivityAt != null && lead.lastActivityAt >= sevenDaysAgo
  if (!hasRecentActivity) {
    gaps.push('no_recent_activity')
  }

  // Check for no future meeting
  const futureMeeting = await db.activity.findFirst({
    where: {
      leadId,
      type: 'MEETING',
      meetingDate: { gt: now },
    },
  })
  const hasFutureMeeting = futureMeeting != null
  if (!hasFutureMeeting) {
    gaps.push('no_future_meeting')
  }

  // Check for single-threaded (≤1 contact linked)
  // Skip this check if there's both a future meeting AND recent activity
  const contactCount = await db.leadContact.count({
    where: { leadId },
  })

  if (contactCount <= 1) {
    const skipSingleThreaded = hasFutureMeeting && hasRecentActivity
    if (!skipSingleThreaded) {
      gaps.push('single_threaded')
    }
  }

  return gaps
}
