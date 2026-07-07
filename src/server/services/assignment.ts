import { createTenantPrisma } from '@/server/db/middleware'
import { redis } from '@/lib/upstash/redis'

/**
 * Shape of a lead passed to the assignment rule engine.
 * Only the fields needed for rule evaluation are required.
 */
export interface LeadForAssignment {
  id: string
  assignedUserId: string | null
  companyName: string | null
  country: string | null
  state: string | null
  dealValue: number | null
}

/**
 * Configuration for a TERRITORY assignment rule.
 * Matches leads by company name patterns and/or region (country/state).
 */
export interface TerritoryConfig {
  companies?: string[]
  countries?: string[]
  states?: string[]
  userId: string
}

/**
 * Configuration for a DEAL_SIZE assignment rule.
 * Matches leads whose dealValue falls within [min, max] range.
 */
export interface DealSizeConfig {
  min?: number
  max?: number
  userId: string
}

/**
 * Configuration for a ROUND_ROBIN assignment rule.
 * Distributes leads evenly among a list of user IDs using an Upstash Redis counter.
 */
export interface RoundRobinConfig {
  userIds: string[]
}

/**
 * Result of assignment rule evaluation.
 */
export interface AssignmentResult {
  assignedUserId: string | null
  ruleId: string | null
  ruleType: string | null
}

/**
 * Evaluates assignment rules for a lead in priority order (lowest priority number first).
 *
 * - If the lead already has an assignee, skips evaluation entirely and returns null.
 * - Fetches active assignment rules for the organization, ordered by priority ASC.
 * - For each rule, evaluates the condition:
 *   - TERRITORY: checks if lead's companyName/country/state matches config patterns
 *   - DEAL_SIZE: checks if lead's dealValue is within config.min/config.max range
 *   - ROUND_ROBIN: uses Upstash Redis counter to distribute evenly among config.userIds
 * - First matching rule assigns the lead (updates lead.assignedUserId).
 * - If no rule matches, leaves the lead unassigned (returns null assignedUserId).
 *
 * Validates: Requirements 16.4, 16.5, 16.6
 */
export async function evaluateAssignmentRules(
  lead: LeadForAssignment,
  orgId: string,
): Promise<AssignmentResult> {
  // Skip evaluation entirely if lead already has an assignee
  if (lead.assignedUserId) {
    return { assignedUserId: lead.assignedUserId, ruleId: null, ruleType: null }
  }

  const db = createTenantPrisma(orgId)

  // Fetch active assignment rules ordered by priority ASC (lowest number = highest priority)
  const rules = await db.assignmentRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  })

  // Evaluate each rule in priority order
  for (const rule of rules) {
    const assignedUserId = await evaluateRule(rule, lead)

    if (assignedUserId) {
      // First matching rule assigns the lead
      await db.lead.update({
        where: { id: lead.id },
        data: { assignedUserId },
      })

      return { assignedUserId, ruleId: rule.id, ruleType: rule.type }
    }
  }

  // No rule matched — leave unassigned
  return { assignedUserId: null, ruleId: null, ruleType: null }
}

/**
 * Evaluates a single assignment rule against a lead.
 * Returns the userId to assign, or null if the rule doesn't match.
 */
async function evaluateRule(
  rule: { id: string; type: string; config: unknown },
  lead: LeadForAssignment,
): Promise<string | null> {
  switch (rule.type) {
    case 'TERRITORY':
      return evaluateTerritoryRule(rule.config as TerritoryConfig, lead)
    case 'DEAL_SIZE':
      return evaluateDealSizeRule(rule.config as DealSizeConfig, lead)
    case 'ROUND_ROBIN':
      return evaluateRoundRobinRule(rule.id, rule.config as RoundRobinConfig)
    default:
      return null
  }
}

/**
 * Evaluates a TERRITORY rule.
 *
 * Matches if the lead's companyName, country, or state matches any of the
 * configured patterns (case-insensitive). At least one configured dimension
 * must match for the rule to apply.
 */
function evaluateTerritoryRule(
  config: TerritoryConfig,
  lead: LeadForAssignment,
): string | null {
  let hasConditions = false
  let matchesAny = false

  // Check company name match
  if (config.companies && config.companies.length > 0) {
    hasConditions = true
    if (lead.companyName) {
      const leadCompany = lead.companyName.toLowerCase()
      const matches = config.companies.some(
        (pattern) => leadCompany.includes(pattern.toLowerCase()),
      )
      if (matches) matchesAny = true
    }
  }

  // Check country match
  if (config.countries && config.countries.length > 0) {
    hasConditions = true
    if (lead.country) {
      const leadCountry = lead.country.toLowerCase()
      const matches = config.countries.some(
        (c) => c.toLowerCase() === leadCountry,
      )
      if (matches) matchesAny = true
    }
  }

  // Check state match
  if (config.states && config.states.length > 0) {
    hasConditions = true
    if (lead.state) {
      const leadState = lead.state.toLowerCase()
      const matches = config.states.some(
        (s) => s.toLowerCase() === leadState,
      )
      if (matches) matchesAny = true
    }
  }

  // Rule must have at least one condition and at least one must match
  if (hasConditions && matchesAny) {
    return config.userId
  }

  return null
}

/**
 * Evaluates a DEAL_SIZE rule.
 *
 * Matches if the lead's dealValue falls within the configured [min, max] range.
 * If min is not set, there's no lower bound. If max is not set, there's no upper bound.
 * If the lead has no dealValue, the rule does not match.
 */
function evaluateDealSizeRule(
  config: DealSizeConfig,
  lead: LeadForAssignment,
): string | null {
  // If lead has no deal value, rule cannot match
  if (lead.dealValue === null || lead.dealValue === undefined) {
    return null
  }

  const value = Number(lead.dealValue)

  // Check min bound
  if (config.min !== undefined && config.min !== null && value < config.min) {
    return null
  }

  // Check max bound
  if (config.max !== undefined && config.max !== null && value > config.max) {
    return null
  }

  return config.userId
}

/**
 * Evaluates a ROUND_ROBIN rule.
 *
 * Uses Upstash Redis counter (`round_robin:{ruleId}`) to distribute leads
 * evenly among the configured userIds. The counter is incremented atomically,
 * and the assignee is determined by `counter % userIds.length`.
 *
 * Always matches if userIds is non-empty (round-robin distributes unconditionally).
 */
async function evaluateRoundRobinRule(
  ruleId: string,
  config: RoundRobinConfig,
): Promise<string | null> {
  if (!config.userIds || config.userIds.length === 0) {
    return null
  }

  // Atomically increment the round-robin counter
  const counter = await redis.incr(`round_robin:${ruleId}`)

  // Pick the assignee based on counter modulo number of users
  const index = (counter - 1) % config.userIds.length
  return config.userIds[index]
}
