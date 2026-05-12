import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for lead scoring and assignment.
 *
 * These tests verify that:
 * 1. Lead score is always in range [0, 100] after any calculation
 * 2. Assignment rules are evaluated in ascending priority order
 * 3. Round-robin distribution produces even allocation
 * 4. Adding an activity to a lead never decreases its score
 *
 * **Validates: Requirements 16.1, 16.3, 16.4, 16.5**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  scoringRule: {
    findMany: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  scoreHistory: {
    create: vi.fn(),
  },
  assignmentRule: {
    findMany: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'ScoringRule', 'ScoreHistory', 'AssignmentRule'],
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

const mockRedisIncr = vi.fn()
vi.mock('@/lib/upstash/redis', () => ({
  redis: {
    incr: (...args: unknown[]) => mockRedisIncr(...args),
  },
}))

import { clampScore, calculateScore } from '@/server/services/scoring'
import { evaluateAssignmentRules } from '@/server/services/assignment'
import type { LeadForAssignment } from '@/server/services/assignment'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate any number (including extreme values) to test clamping */
const anyScoreArb = fc.oneof(
  fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  fc.integer({ min: -10000, max: 10000 }),
  fc.constantFrom(-Infinity, Infinity, -1, 0, 50, 100, 101, -0.5, 100.5),
)

/** Generate a positive integer for activity counts */
const activityCountArb = fc.nat({ max: 100 })

/** Generate a positive deal value */
const dealValueArb = fc.oneof(
  fc.constant(null),
  fc.nat({ max: 10000000 }),
)

/** Generate scoring rule points (positive multiplier) */
const pointsArb = fc.integer({ min: 1, max: 20 })

/** Generate a threshold for scoring rules */
const thresholdArb = fc.integer({ min: 1, max: 50 })

/** Generate a list of user IDs for round-robin (1 to 10 users) */
const userIdsArb = fc.array(uuidArb, { minLength: 1, maxLength: 10 })

/** Generate a priority number (lower = higher priority) */
const priorityArb = fc.integer({ min: 1, max: 100 })

/** Generate a lead for assignment */
const leadForAssignmentArb = fc.record({
  id: uuidArb,
  assignedUserId: fc.constant(null as string | null),
  companyName: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
  country: fc.oneof(fc.constant(null), fc.constantFrom('US', 'UK', 'DE', 'FR', 'JP')),
  state: fc.oneof(fc.constant(null), fc.constantFrom('California', 'New York', 'Texas', 'Florida')),
  dealValue: fc.oneof(fc.constant(null), fc.nat({ max: 1000000 })),
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Lead Scoring and Assignment - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Lead score is always in range [0, 100] after any calculation', () => {
    /**
     * **Validates: Requirements 16.1, 16.3**
     *
     * The clampScore function ensures that regardless of the raw computed
     * score (which could be negative, exceed 100, or be any floating point
     * value), the final score is always clamped to [0, 100].
     */

    it('clampScore always returns a value in [0, 100] for any numeric input', () => {
      fc.assert(
        fc.property(
          anyScoreArb,
          (rawScore) => {
            const clamped = clampScore(rawScore)

            expect(clamped).toBeGreaterThanOrEqual(0)
            expect(clamped).toBeLessThanOrEqual(100)
          },
        ),
      )
    })

    it('clampScore preserves values already within [0, 100]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          (validScore) => {
            const clamped = clampScore(validScore)
            expect(clamped).toBe(validScore)
          },
        ),
      )
    })

    it('clampScore clamps negative values to 0', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -10000, max: -1 }),
          (negativeScore) => {
            const clamped = clampScore(negativeScore)
            expect(clamped).toBe(0)
          },
        ),
      )
    })

    it('clampScore clamps values above 100 to 100', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 101, max: 10000 }),
          (highScore) => {
            const clamped = clampScore(highScore)
            expect(clamped).toBe(100)
          },
        ),
      )
    })

    it('calculateScore always returns a value in [0, 100] regardless of rule configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          activityCountArb, // number of activities
          dealValueArb, // deal value
          fc.array(
            fc.record({
              id: uuidArb,
              type: fc.constantFrom('activity_count', 'deal_value', 'stage_progression', 'email_engagement'),
              points: pointsArb,
              isActive: fc.constant(true),
              config: fc.record({
                threshold: fc.oneof(fc.constant(undefined), thresholdArb),
                divisor: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 10000 })),
              }),
            }),
            { minLength: 1, maxLength: 5 },
          ), // scoring rules
          async (leadId, orgId, activityCount, dealValue, rules) => {
            // Generate activities array
            const activities = Array.from({ length: activityCount }, (_, i) => ({
              type: i % 3 === 0 ? 'EMAIL' : i % 3 === 1 ? 'CALL' : 'NOTE',
            }))

            const lead = {
              id: leadId,
              score: 50,
              dealValue,
              activities,
              stageTransitions: Array.from({ length: Math.floor(activityCount / 3) }, () => ({ id: 'st-1' })),
              stage: { id: 'stage-1', order: 1 },
              deletedAt: null,
            }

            mockDb.scoringRule.findMany.mockResolvedValue(rules)
            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.lead.update.mockResolvedValue({ ...lead, score: 0 })
            mockDb.scoreHistory.create.mockResolvedValue({})

            const score = await calculateScore(leadId, orgId)

            expect(score).toBeGreaterThanOrEqual(0)
            expect(score).toBeLessThanOrEqual(100)
            expect(Number.isInteger(score)).toBe(true)
          },
        ),
      )
    })
  })

  describe('Property: Assignment rules are evaluated in ascending priority order', () => {
    /**
     * **Validates: Requirements 16.4**
     *
     * The evaluateAssignmentRules function fetches rules with
     * `orderBy: { priority: 'asc' }`, ensuring that the lowest priority
     * number (highest priority) is evaluated first. The first matching
     * rule wins.
     */

    it('rules are fetched with orderBy priority ascending', async () => {
      await fc.assert(
        fc.asyncProperty(
          leadForAssignmentArb,
          uuidArb, // orgId
          fc.array(
            fc.record({
              id: uuidArb,
              type: fc.constantFrom('TERRITORY', 'DEAL_SIZE', 'ROUND_ROBIN'),
              priority: priorityArb,
              isActive: fc.constant(true),
              config: fc.constant({ companies: ['NonExistent'], userId: 'user-1' }),
            }),
            { minLength: 1, maxLength: 5 },
          ),
          async (lead, orgId, rules) => {
            // Sort rules by priority ascending (as the service should do)
            const sortedRules = [...rules].sort((a, b) => a.priority - b.priority)
            mockDb.assignmentRule.findMany.mockResolvedValue(sortedRules)

            await evaluateAssignmentRules(lead, orgId)

            // Verify findMany was called with orderBy: { priority: 'asc' }
            expect(mockDb.assignmentRule.findMany).toHaveBeenCalledWith({
              where: { isActive: true },
              orderBy: { priority: 'asc' },
            })
          },
        ),
      )
    })

    it('first matching rule in priority order wins over later rules', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          userIdsArb, // user IDs for assignment
          async (orgId, userIds) => {
            if (userIds.length < 2) return // Need at least 2 users

            const lead: LeadForAssignment = {
              id: 'lead-priority-test',
              assignedUserId: null,
              companyName: 'Acme Corp',
              country: 'US',
              state: 'California',
              dealValue: 50000,
            }

            // Create two TERRITORY rules that both match, with different priorities
            const rules = [
              {
                id: 'rule-high-priority',
                type: 'TERRITORY',
                priority: 1,
                config: { companies: ['Acme'], userId: userIds[0] },
                isActive: true,
              },
              {
                id: 'rule-low-priority',
                type: 'TERRITORY',
                priority: 2,
                config: { countries: ['US'], userId: userIds[1] },
                isActive: true,
              },
            ]

            mockDb.assignmentRule.findMany.mockResolvedValue(rules)
            mockDb.lead.update.mockResolvedValue({ ...lead, assignedUserId: userIds[0] })

            const result = await evaluateAssignmentRules(lead, orgId)

            // The first rule (priority 1) should win
            expect(result.assignedUserId).toBe(userIds[0])
            expect(result.ruleId).toBe('rule-high-priority')
          },
        ),
      )
    })
  })

  describe('Property: Round-robin distribution produces even allocation', () => {
    /**
     * **Validates: Requirements 16.5**
     *
     * Round-robin uses a Redis counter modulo the number of users.
     * For N users and N*k leads (where k is any positive integer),
     * each user should receive exactly k leads. The counter mod N
     * cycles through all users evenly.
     */

    it('counter mod N cycles through all users for N consecutive assignments', () => {
      fc.assert(
        fc.property(
          userIdsArb,
          fc.integer({ min: 1, max: 5 }), // number of full cycles
          (userIds, cycles) => {
            const n = userIds.length
            const totalAssignments = n * cycles

            // Track assignments per user
            const assignmentCounts = new Map<string, number>()
            for (const userId of userIds) {
              assignmentCounts.set(userId, 0)
            }

            // Simulate N*cycles assignments using the same formula as the service
            for (let counter = 1; counter <= totalAssignments; counter++) {
              const index = (counter - 1) % n
              const assignedUser = userIds[index]
              assignmentCounts.set(assignedUser, (assignmentCounts.get(assignedUser) ?? 0) + 1)
            }

            // Each user should have exactly `cycles` assignments
            for (const userId of userIds) {
              expect(assignmentCounts.get(userId)).toBe(cycles)
            }
          },
        ),
      )
    })

    it('round-robin with N users distributes evenly via Redis counter', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // orgId
          userIdsArb,
          fc.integer({ min: 1, max: 3 }), // number of full cycles
          async (orgId, userIds, cycles) => {
            const n = userIds.length
            const totalAssignments = n * cycles

            const ruleId = 'rule-rr-even'
            const rules = [
              {
                id: ruleId,
                type: 'ROUND_ROBIN',
                priority: 1,
                config: { userIds },
                isActive: true,
              },
            ]

            mockDb.assignmentRule.findMany.mockResolvedValue(rules)
            mockDb.lead.update.mockResolvedValue({})

            // Track assignments per user
            const assignmentCounts = new Map<string, number>()
            for (const userId of userIds) {
              assignmentCounts.set(userId, 0)
            }

            // Simulate totalAssignments leads being assigned
            for (let i = 1; i <= totalAssignments; i++) {
              mockRedisIncr.mockResolvedValueOnce(i)

              const lead: LeadForAssignment = {
                id: `lead-${i}`,
                assignedUserId: null,
                companyName: null,
                country: null,
                state: null,
                dealValue: null,
              }

              const result = await evaluateAssignmentRules(lead, orgId)

              if (result.assignedUserId) {
                assignmentCounts.set(
                  result.assignedUserId,
                  (assignmentCounts.get(result.assignedUserId) ?? 0) + 1,
                )
              }
            }

            // Each user should have exactly `cycles` assignments
            for (const userId of userIds) {
              expect(assignmentCounts.get(userId)).toBe(cycles)
            }
          },
        ),
      )
    })

    it('any counter value maps to a valid user index', () => {
      fc.assert(
        fc.property(
          userIdsArb,
          fc.integer({ min: 1, max: 100000 }), // any counter value
          (userIds, counter) => {
            const n = userIds.length
            const index = (counter - 1) % n

            // Index is always valid
            expect(index).toBeGreaterThanOrEqual(0)
            expect(index).toBeLessThan(n)

            // The selected user exists
            expect(userIds[index]).toBeDefined()
          },
        ),
      )
    })
  })

  describe('Property: Adding an activity to a lead never decreases its score', () => {
    /**
     * **Validates: Requirements 16.1**
     *
     * When an activity_count scoring rule is active, adding more activities
     * to a lead should never decrease the score. The score is monotonically
     * non-decreasing with respect to activity count (assuming positive points).
     */

    it('increasing activity count never decreases score when activity_count rule is active', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          activityCountArb, // base activity count
          fc.integer({ min: 1, max: 20 }), // additional activities
          pointsArb, // points per activity
          fc.oneof(fc.constant(undefined), thresholdArb), // optional threshold
          async (leadId, orgId, baseCount, additionalCount, points, threshold) => {
            const rule = {
              id: 'rule-activity',
              type: 'activity_count',
              points,
              isActive: true,
              config: { threshold },
            }

            mockDb.scoringRule.findMany.mockResolvedValue([rule])
            mockDb.scoreHistory.create.mockResolvedValue({})

            // Calculate score with base activity count
            const baseActivities = Array.from({ length: baseCount }, () => ({ type: 'CALL' }))
            const baseLead = {
              id: leadId,
              score: 0,
              dealValue: null,
              activities: baseActivities,
              stageTransitions: [],
              stage: { id: 'stage-1', order: 1 },
              deletedAt: null,
            }

            mockDb.lead.findFirst.mockResolvedValue(baseLead)
            mockDb.lead.update.mockResolvedValue({ ...baseLead, score: 0 })

            const scoreWithBase = await calculateScore(leadId, orgId)

            // Calculate score with more activities
            const moreActivities = Array.from(
              { length: baseCount + additionalCount },
              () => ({ type: 'CALL' }),
            )
            const leadWithMore = {
              ...baseLead,
              activities: moreActivities,
            }

            mockDb.lead.findFirst.mockResolvedValue(leadWithMore)
            mockDb.lead.update.mockResolvedValue({ ...leadWithMore, score: 0 })

            const scoreWithMore = await calculateScore(leadId, orgId)

            // Score should never decrease when adding activities
            expect(scoreWithMore).toBeGreaterThanOrEqual(scoreWithBase)
          },
        ),
      )
    })

    it('score is monotonically non-decreasing as activity count grows', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          pointsArb, // points per activity
          fc.array(fc.nat({ max: 30 }), { minLength: 2, maxLength: 5 }).map(arr =>
            [...arr].sort((a, b) => a - b),
          ), // sorted activity counts
          async (leadId, orgId, points, sortedCounts) => {
            const rule = {
              id: 'rule-activity-mono',
              type: 'activity_count',
              points,
              isActive: true,
              config: {},
            }

            mockDb.scoringRule.findMany.mockResolvedValue([rule])
            mockDb.scoreHistory.create.mockResolvedValue({})

            const scores: number[] = []

            for (const count of sortedCounts) {
              const activities = Array.from({ length: count }, () => ({ type: 'CALL' }))
              const lead = {
                id: leadId,
                score: 0,
                dealValue: null,
                activities,
                stageTransitions: [],
                stage: { id: 'stage-1', order: 1 },
                deletedAt: null,
              }

              mockDb.lead.findFirst.mockResolvedValue(lead)
              mockDb.lead.update.mockResolvedValue({ ...lead, score: 0 })

              const score = await calculateScore(leadId, orgId)
              scores.push(score)
            }

            // Scores should be monotonically non-decreasing
            for (let i = 1; i < scores.length; i++) {
              expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
            }
          },
        ),
      )
    })
  })
})
