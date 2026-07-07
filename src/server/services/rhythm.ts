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

// ─── Batched Rhythm Snapshot ─────────────────────────────────────────────────

/**
 * Combined engagement + health + gaps for a single lead in the batch view.
 * Missing leads (deleted, wrong org, or not found) are simply absent from
 * the returned map — callers should handle that as "no snapshot available"
 * rather than treating it as an error, since the batch path is optimistic
 * about the input set.
 */
export interface RhythmSnapshotEntry {
  leadId: string
  engagementScore: number
  health: DealHealth
  gaps: DealGap[]
}

/**
 * Batched rhythm computation for a set of leads.
 *
 * The per-lead functions (`calculateDealEngagementScore`, `identifyDealGaps`)
 * issue six DB round-trips each — at dashboard scale (up to 500 open
 * leads) that's ~3,000 queries per page render. This function collapses
 * the entire workload into **four** queries regardless of how many leads
 * are in the input set:
 *
 *   1. `lead.findMany` — leads with stage + pipeline stages
 *   2. `leadContact.groupBy` — contact count per lead
 *   3. `activity.groupBy` — activity count (last 30 days) per lead
 *   4. `activity.findMany` — leads with a future meeting
 *
 * The scoring / gap formulas are identical to the single-lead functions
 * so behavior is unchanged; only the query pattern shifts. Both single-
 * lead functions remain callable and semantically equivalent — they are
 * the right tool when you need one specific score and can tolerate the
 * extra queries.
 *
 * Empty input returns an empty map without hitting the database.
 *
 * Validates: Requirements 9.4, 9.5, 9.6
 */
export async function getRhythmSnapshot(
  leadIds: readonly string[],
  orgId: string,
): Promise<Map<string, RhythmSnapshotEntry>> {
  const results = new Map<string, RhythmSnapshotEntry>()
  if (leadIds.length === 0) return results

  const db = createTenantPrisma(orgId)
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const ids = [...leadIds]

  // 1. Leads + stage/pipeline (single query, includes all stages the
  //    pipeline uses so the progression ratio can be computed).
  const leadsPromise = db.lead.findMany({
    where: { id: { in: ids }, deletedAt: null },
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

  // 2. Contact counts grouped by lead. Leads with zero linked contacts
  //    simply don't appear in the result set — treated as 0 downstream.
  const contactCountsPromise = db.leadContact.groupBy({
    by: ['leadId'],
    where: { leadId: { in: ids } },
    _count: { _all: true },
  })

  // 3. Activity counts (last 30 days) grouped by lead.
  const activityCountsPromise = db.activity.groupBy({
    by: ['leadId'],
    where: {
      leadId: { in: ids },
      createdAt: { gte: thirtyDaysAgo },
    },
    _count: { _all: true },
  })

  // 4. Future meetings — one row per lead-with-meeting via `distinct`.
  //    We only need "does this lead have any future meeting"; the actual
  //    meeting rows are irrelevant here.
  const futureMeetingsPromise = db.activity.findMany({
    where: {
      leadId: { in: ids },
      type: 'MEETING',
      meetingDate: { gt: now },
    },
    select: { leadId: true },
    distinct: ['leadId'],
  })

  const [leads, contactCountRows, activityCountRows, futureMeetingRows] =
    await Promise.all([
      leadsPromise,
      contactCountsPromise,
      activityCountsPromise,
      futureMeetingsPromise,
    ])

  const contactCounts = new Map<string, number>()
  for (const row of contactCountRows) {
    if (row.leadId) contactCounts.set(row.leadId, row._count._all)
  }
  const activityCounts = new Map<string, number>()
  for (const row of activityCountRows) {
    if (row.leadId) activityCounts.set(row.leadId, row._count._all)
  }
  const leadsWithFutureMeeting = new Set<string>()
  for (const row of futureMeetingRows) {
    if (row.leadId) leadsWithFutureMeeting.add(row.leadId)
  }

  for (const lead of leads) {
    const contactCount = contactCounts.get(lead.id) ?? 0
    const activityCount = activityCounts.get(lead.id) ?? 0
    const hasFutureMeeting = leadsWithFutureMeeting.has(lead.id)

    const engagementScore = composeEngagementScore({
      lastActivityAt: lead.lastActivityAt,
      leadScore: lead.score,
      stageId: lead.stageId,
      stages: lead.stage.pipeline.stages,
      contactCount,
      activityCount,
      now,
    })

    const gaps = composeGaps({
      lastActivityAt: lead.lastActivityAt,
      contactCount,
      hasFutureMeeting,
      sevenDaysAgo,
    })

    results.set(lead.id, {
      leadId: lead.id,
      engagementScore,
      health: classifyDealHealth(engagementScore),
      gaps,
    })
  }

  return results
}

/**
 * Pure engagement-score composer. Kept private so the single-lead and
 * batch code paths stay in lock-step on the scoring formula. Exported
 * only via the batch function's return value.
 */
function composeEngagementScore(input: {
  lastActivityAt: Date | null
  leadScore: number
  stageId: string
  stages: readonly { id: string; order: number }[]
  contactCount: number
  activityCount: number
  now: Date
}): number {
  let score = 0

  // Activity Recency (0-25)
  if (input.lastActivityAt) {
    const days =
      (input.now.getTime() - input.lastActivityAt.getTime())
      / (1000 * 60 * 60 * 24)
    if (days <= 0) score += 25
    else if (days >= 30) score += 0
    else score += Math.round(25 * (1 - days / 30))
  }

  // Stakeholder Count (0-20)
  score += Math.min(Math.floor(input.contactCount * (20 / 5)), 20)

  // Activity Volume (0-20)
  score += Math.min(Math.floor(input.activityCount * (20 / 10)), 20)

  // Deal Progression (0-20)
  if (input.stages.length > 1) {
    const idx = input.stages.findIndex((s) => s.id === input.stageId)
    if (idx >= 0) {
      const ratio = idx / (input.stages.length - 1)
      score += Math.round(ratio * 20)
    }
  }

  // Lead Score (0-15)
  score += Math.round((input.leadScore / 100) * 15)

  return Math.max(1, Math.min(score, 100))
}

/**
 * Pure gap composer, matching the single-lead `identifyDealGaps` rules
 * exactly. Kept alongside `composeEngagementScore` so both paths share
 * the same source of truth for gap detection.
 */
function composeGaps(input: {
  lastActivityAt: Date | null
  contactCount: number
  hasFutureMeeting: boolean
  sevenDaysAgo: Date
}): DealGap[] {
  const gaps: DealGap[] = []
  const hasRecentActivity =
    input.lastActivityAt != null && input.lastActivityAt >= input.sevenDaysAgo

  if (!hasRecentActivity) gaps.push('no_recent_activity')
  if (!input.hasFutureMeeting) gaps.push('no_future_meeting')
  if (input.contactCount <= 1) {
    const skipSingleThreaded = input.hasFutureMeeting && hasRecentActivity
    if (!skipSingleThreaded) gaps.push('single_threaded')
  }
  return gaps
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
 * For rendering multiple leads at once (e.g. the dashboard), prefer
 * `getRhythmSnapshot` which does the same work in a fixed number of
 * queries rather than N per lead.
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
