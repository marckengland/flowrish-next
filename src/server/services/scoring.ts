import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { AppError } from '@/lib/errors'

/**
 * Valid scoring rule types that can be configured per organization.
 */
const VALID_RULE_TYPES = [
  'activity_count',
  'deal_value',
  'stage_progression',
  'email_engagement',
] as const

export type ScoringRuleType = (typeof VALID_RULE_TYPES)[number]

/**
 * Clamps a score to the valid range [0, 100].
 */
export function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score))
}

/**
 * Calculates a lead's score (0-100) based on the organization's active scoring rules.
 *
 * For each active rule, computes a raw value from the lead's data and multiplies
 * by the rule's configured points. The sum is clamped to [0, 100], the lead's
 * score field is updated, and a ScoreHistory entry is created.
 *
 * Rule evaluation:
 * - activity_count: number of activities on the lead
 * - deal_value: lead's deal value normalized (per $1000 = 1 raw point)
 * - stage_progression: number of stage transitions
 * - email_engagement: number of EMAIL-type activities
 *
 * Config can optionally contain thresholds/multipliers per rule type.
 *
 * Validates: Requirements 16.1, 16.2, 16.3
 */
export async function calculateScore(
  leadId: string,
  orgId: string,
): Promise<number> {
  const db = createTenantPrisma(orgId)

  // Fetch active scoring rules for this organization
  const activeRules = await db.scoringRule.findMany({
    where: { isActive: true },
  })

  // If no active rules, score is 0
  if (activeRules.length === 0) {
    const lead = await db.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    })
    if (!lead) {
      throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
    }

    const previousScore = lead.score
    const newScore = 0

    if (previousScore !== newScore) {
      await db.lead.update({
        where: { id: leadId },
        data: { score: newScore },
      })
      await recordScoreChange(leadId, previousScore, newScore, 'no_active_rules', orgId)
    }

    return newScore
  }

  // Fetch lead with related data needed for scoring
  const lead = await db.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    include: {
      activities: true,
      stageTransitions: true,
      stage: true,
    },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
  }

  // Evaluate each rule and sum points
  let totalScore = 0

  for (const rule of activeRules) {
    const rawValue = computeRawValue(rule.type, rule.config, lead)
    totalScore += rawValue * rule.points
  }

  // Clamp to [0, 100]
  const newScore = clampScore(Math.round(totalScore))
  const previousScore = lead.score

  // Update lead score
  await db.lead.update({
    where: { id: leadId },
    data: { score: newScore },
  })

  // Record score change
  await recordScoreChange(leadId, previousScore, newScore, 'score_recalculation', orgId)

  return newScore
}

/**
 * Records a score change in the ScoreHistory table.
 *
 * Creates a ScoreHistory entry with the previous score, new score, and reason
 * for the change. The organizationId is auto-injected by the tenant middleware.
 *
 * Validates: Requirements 16.2
 */
export async function recordScoreChange(
  leadId: string,
  previousScore: number,
  newScore: number,
  reason: string,
  orgId: string,
): Promise<void> {
  const db = createTenantPrisma(orgId)

  await db.scoreHistory.create({
    data: tenantData({
      leadId,
      previousScore,
      newScore: clampScore(newScore),
      reason,
    }),
  })
}

/**
 * Computes the raw value for a scoring rule type based on lead data.
 *
 * The raw value is multiplied by the rule's points to get the contribution
 * to the total score. Config can contain optional thresholds:
 * - activity_count: { threshold?: number } — cap raw value at threshold
 * - deal_value: { divisor?: number } — normalize by divisor (default 1000)
 * - stage_progression: { threshold?: number } — cap raw value at threshold
 * - email_engagement: { threshold?: number } — cap raw value at threshold
 */
function computeRawValue(
  ruleType: string,
  config: unknown,
  lead: LeadWithRelations,
): number {
  const cfg = (config as Record<string, unknown>) ?? {}

  switch (ruleType) {
    case 'activity_count': {
      const count = lead.activities?.length ?? 0
      const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : Infinity
      return Math.min(count, threshold)
    }

    case 'deal_value': {
      const dealValue = lead.dealValue ? Number(lead.dealValue) : 0
      if (dealValue <= 0) return 0
      const divisor = typeof cfg.divisor === 'number' && cfg.divisor > 0 ? cfg.divisor : 1000
      return dealValue / divisor
    }

    case 'stage_progression': {
      const transitions = lead.stageTransitions?.length ?? 0
      const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : Infinity
      return Math.min(transitions, threshold)
    }

    case 'email_engagement': {
      const emailActivities = (lead.activities ?? []).filter(
        (a) => a.type === 'EMAIL',
      )
      const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : Infinity
      return Math.min(emailActivities.length, threshold)
    }

    default:
      return 0
  }
}

/**
 * Type for lead with included relations needed for scoring.
 */
interface LeadWithRelations {
  id: string
  score: number
  dealValue: unknown // Decimal type from Prisma
  activities: Array<{ type: string }>
  stageTransitions: Array<{ id: string }>
  stage: { id: string; order: number } | null
}
