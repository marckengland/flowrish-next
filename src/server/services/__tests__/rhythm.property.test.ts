import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for the Rhythm Engine (signal-based prioritization).
 *
 * These tests verify that:
 * 1. calculatePriorityScore always returns a value clamped to [1, 100]
 * 2. calculateDealEngagementScore always returns a value clamped to [1, 100]
 * 3. Increasing dealValue never decreases the priority score
 * 4. Same inputs always produce the same priority score (determinism/confluence)
 *
 * **Validates: Requirements 9.1, 9.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findFirst: vi.fn(),
  },
  leadContact: {
    count: vi.fn(),
  },
  activity: {
    count: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Activity', 'LeadContact'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { calculatePriorityScore, calculateDealEngagementScore } from '@/server/services/rhythm'
import type { PriorityAction } from '@/server/services/rhythm'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate a date within a reasonable range */
const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })

/** Generate a priority level */
const priorityArb = fc.constantFrom('LOW' as const, 'MEDIUM' as const, 'HIGH' as const)

/**
 * Generate a PriorityAction with arbitrary signal combinations.
 * Each field is optional/nullable to cover all input shapes.
 */
const priorityActionArb: fc.Arbitrary<PriorityAction> = fc.record({
  dueDate: fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    dateArb,
    dateArb.map(d => d.toISOString()),
  ),
  dealValue: fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.double({ min: 0, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
  ),
  leadScore: fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }),
  ),
  lastActivityAt: fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    dateArb,
    dateArb.map(d => d.toISOString()),
  ),
  priority: fc.oneof(
    fc.constant(undefined),
    priorityArb,
  ),
})

/**
 * Generate a PriorityAction with a specific dealValue for monotonicity testing.
 * All other fields are fixed so we can isolate the effect of dealValue.
 */
const actionWithDealValueArb = fc.record({
  dueDate: fc.oneof(fc.constant(null), fc.constant(undefined), dateArb),
  leadScore: fc.oneof(fc.constant(null), fc.constant(undefined), fc.integer({ min: 0, max: 100 })),
  lastActivityAt: fc.oneof(fc.constant(null), fc.constant(undefined), dateArb),
  priority: fc.oneof(fc.constant(undefined), priorityArb),
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rhythm Engine - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Priority score is always clamped to [1, 100]', () => {
    /**
     * **Validates: Requirements 9.1**
     *
     * The calculatePriorityScore function must always return a value
     * in the range [1, 100], regardless of the combination of input signals.
     * This includes extreme values (very large deal values, very old dates,
     * maximum lead scores, etc.).
     */

    it('calculatePriorityScore always returns a value in [1, 100] for any input', () => {
      fc.assert(
        fc.property(
          priorityActionArb,
          (action) => {
            const score = calculatePriorityScore(action)

            expect(score).toBeGreaterThanOrEqual(1)
            expect(score).toBeLessThanOrEqual(100)
          },
        ),
        { numRuns: 1000 },
      )
    })

    it('calculatePriorityScore returns an integer', () => {
      fc.assert(
        fc.property(
          priorityActionArb,
          (action) => {
            const score = calculatePriorityScore(action)

            expect(Number.isInteger(score)).toBe(true)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('calculatePriorityScore returns at least 1 even with all null/undefined inputs', () => {
      const emptyAction: PriorityAction = {
        dueDate: null,
        dealValue: null,
        leadScore: null,
        lastActivityAt: null,
        priority: undefined,
      }

      const score = calculatePriorityScore(emptyAction)
      expect(score).toBeGreaterThanOrEqual(1)
    })

    it('calculatePriorityScore returns at most 100 even with extreme inputs', () => {
      fc.assert(
        fc.property(
          // Generate extreme values that would push score way above 100
          fc.record({
            dueDate: fc.constant(new Date('2020-01-01')), // very overdue
            dealValue: fc.constant(10_000_000), // very high deal value
            leadScore: fc.constant(100), // max lead score
            lastActivityAt: fc.constant(new Date('2020-01-01')), // very inactive
            priority: fc.constant('HIGH' as const),
          }),
          (action) => {
            const score = calculatePriorityScore(action)

            expect(score).toBeLessThanOrEqual(100)
          },
        ),
      )
    })
  })

  describe('Property: Deal Engagement Score is always clamped to [1, 100]', () => {
    /**
     * **Validates: Requirements 9.4**
     *
     * The calculateDealEngagementScore function must always return a value
     * in the range [1, 100], regardless of the lead's data (activity recency,
     * stakeholder count, activity volume, deal progression, lead score).
     */

    it('calculateDealEngagementScore always returns a value in [1, 100]', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          fc.nat({ max: 100 }), // lead score
          fc.oneof(fc.constant(null), dateArb), // lastActivityAt
          fc.nat({ max: 20 }), // contact count
          fc.nat({ max: 50 }), // activity count in last 30 days
          fc.integer({ min: 1, max: 10 }), // total stages
          fc.integer({ min: 0, max: 9 }), // current stage index
          async (leadId, orgId, leadScore, lastActivityAt, contactCount, activityCount, totalStages, stageIdx) => {
            // Ensure stageIdx is within bounds
            const currentStageIndex = Math.min(stageIdx, totalStages - 1)

            // Build stages array
            const stages = Array.from({ length: totalStages }, (_, i) => ({
              id: `stage-${i}`,
              order: i + 1,
            }))

            const currentStageId = stages[currentStageIndex].id

            const lead = {
              id: leadId,
              deletedAt: null,
              score: leadScore,
              lastActivityAt,
              stageId: currentStageId,
              stage: {
                id: currentStageId,
                order: currentStageIndex + 1,
                pipeline: {
                  stages,
                },
              },
            }

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.leadContact.count.mockResolvedValue(contactCount)
            mockDb.activity.count.mockResolvedValue(activityCount)

            const score = await calculateDealEngagementScore(leadId, orgId)

            expect(score).toBeGreaterThanOrEqual(1)
            expect(score).toBeLessThanOrEqual(100)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('calculateDealEngagementScore returns at least 1 with minimal engagement', async () => {
      const leadId = 'lead-minimal'
      const orgId = 'org-1'

      const lead = {
        id: leadId,
        deletedAt: null,
        score: 0,
        lastActivityAt: null, // no activity
        stageId: 'stage-0',
        stage: {
          id: 'stage-0',
          order: 1,
          pipeline: {
            stages: [{ id: 'stage-0', order: 1 }],
          },
        },
      }

      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.leadContact.count.mockResolvedValue(0) // no contacts
      mockDb.activity.count.mockResolvedValue(0) // no activities

      const score = await calculateDealEngagementScore(leadId, orgId)

      expect(score).toBeGreaterThanOrEqual(1)
      expect(score).toBeLessThanOrEqual(100)
    })

    it('calculateDealEngagementScore returns at most 100 with maximum engagement', async () => {
      const leadId = 'lead-max'
      const orgId = 'org-1'

      const stages = Array.from({ length: 6 }, (_, i) => ({
        id: `stage-${i}`,
        order: i + 1,
      }))

      const lead = {
        id: leadId,
        deletedAt: null,
        score: 100, // max lead score
        lastActivityAt: new Date(), // just now
        stageId: 'stage-5',
        stage: {
          id: 'stage-5',
          order: 6,
          pipeline: { stages },
        },
      }

      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.leadContact.count.mockResolvedValue(10) // many contacts
      mockDb.activity.count.mockResolvedValue(20) // many activities

      const score = await calculateDealEngagementScore(leadId, orgId)

      expect(score).toBeGreaterThanOrEqual(1)
      expect(score).toBeLessThanOrEqual(100)
    })
  })

  describe('Property: Increasing deal value never decreases priority score', () => {
    /**
     * **Validates: Requirements 9.1**
     *
     * This is a metamorphic property: given the same action with two different
     * deal values where dealValue2 >= dealValue1, the priority score for
     * dealValue2 must be >= the priority score for dealValue1.
     */

    it('higher dealValue produces equal or higher priority score', () => {
      fc.assert(
        fc.property(
          actionWithDealValueArb,
          fc.double({ min: 0, max: 5_000_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0, max: 5_000_000, noNaN: true, noDefaultInfinity: true }),
          (baseAction, value1, value2) => {
            const lowerValue = Math.min(value1, value2)
            const higherValue = Math.max(value1, value2)

            const action1: PriorityAction = { ...baseAction, dealValue: lowerValue }
            const action2: PriorityAction = { ...baseAction, dealValue: higherValue }

            const score1 = calculatePriorityScore(action1)
            const score2 = calculatePriorityScore(action2)

            expect(score2).toBeGreaterThanOrEqual(score1)
          },
        ),
        { numRuns: 1000 },
      )
    })

    it('null dealValue produces equal or lower score than any positive dealValue', () => {
      fc.assert(
        fc.property(
          actionWithDealValueArb,
          fc.double({ min: 0, max: 5_000_000, noNaN: true, noDefaultInfinity: true }),
          (baseAction, dealValue) => {
            const actionWithNull: PriorityAction = { ...baseAction, dealValue: null }
            const actionWithValue: PriorityAction = { ...baseAction, dealValue }

            const scoreNull = calculatePriorityScore(actionWithNull)
            const scoreWithValue = calculatePriorityScore(actionWithValue)

            expect(scoreWithValue).toBeGreaterThanOrEqual(scoreNull)
          },
        ),
        { numRuns: 500 },
      )
    })
  })

  describe('Property: Same inputs in any order produce same priority score (confluence)', () => {
    /**
     * **Validates: Requirements 9.1**
     *
     * The priority score calculation is deterministic — given the same inputs,
     * it always produces the same output regardless of how the properties
     * are ordered in the input object. This verifies confluence/determinism.
     */

    it('calculatePriorityScore is deterministic for the same inputs', () => {
      fc.assert(
        fc.property(
          priorityActionArb,
          (action) => {
            const score1 = calculatePriorityScore(action)
            const score2 = calculatePriorityScore(action)

            expect(score1).toBe(score2)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('property order in the input object does not affect the score', () => {
      fc.assert(
        fc.property(
          priorityActionArb,
          (action) => {
            // Create the same action with properties in different orders
            const action1: PriorityAction = {
              dueDate: action.dueDate,
              dealValue: action.dealValue,
              leadScore: action.leadScore,
              lastActivityAt: action.lastActivityAt,
              priority: action.priority,
            }

            const action2: PriorityAction = {
              priority: action.priority,
              lastActivityAt: action.lastActivityAt,
              leadScore: action.leadScore,
              dealValue: action.dealValue,
              dueDate: action.dueDate,
            }

            const action3: PriorityAction = {
              leadScore: action.leadScore,
              dueDate: action.dueDate,
              priority: action.priority,
              dealValue: action.dealValue,
              lastActivityAt: action.lastActivityAt,
            }

            const score1 = calculatePriorityScore(action1)
            const score2 = calculatePriorityScore(action2)
            const score3 = calculatePriorityScore(action3)

            expect(score1).toBe(score2)
            expect(score2).toBe(score3)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('constructing the action from individual fields produces same score', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant(null), fc.constant(undefined), dateArb),
          fc.oneof(fc.constant(null), fc.constant(undefined), fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true })),
          fc.oneof(fc.constant(null), fc.constant(undefined), fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true })),
          fc.oneof(fc.constant(null), fc.constant(undefined), dateArb),
          fc.oneof(fc.constant(undefined), priorityArb),
          (dueDate, dealValue, leadScore, lastActivityAt, priority) => {
            const action: PriorityAction = { dueDate, dealValue, leadScore, lastActivityAt, priority }

            const score1 = calculatePriorityScore(action)
            const score2 = calculatePriorityScore({ ...action })
            const score3 = calculatePriorityScore(
              JSON.parse(JSON.stringify(action, (_, v) => v instanceof Date ? v.toISOString() : v)),
            )

            expect(score1).toBe(score2)
            // score3 uses string dates instead of Date objects — should still produce same result
            expect(score1).toBe(score3)
          },
        ),
        { numRuns: 500 },
      )
    })
  })
})
