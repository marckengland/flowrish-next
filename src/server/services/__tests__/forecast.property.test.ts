import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for the Revenue Forecasting service.
 *
 * These tests verify that:
 * 1. Weighted pipeline is always ≤ total pipeline value
 * 2. AI predicted is always positive when pipeline has open deals with positive dealValue
 * 3. Adding a deal never decreases total pipeline value
 * 4. assessForecastRisk returns correct risk levels based on gap thresholds
 *
 * **Validates: Requirements 10.1, 10.3**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  forecastSubmission: {
    create: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'ForecastSubmission', 'ForecastSnapshot'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { calculatePipelineMetrics, assessForecastRisk } from '@/server/services/forecast'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a positive deal value */
const dealValueArb = fc.double({ min: 0, max: 10_000_000, noNaN: true, noDefaultInfinity: true })

/** Generate a positive non-zero deal value */
const positiveDealValueArb = fc.double({ min: 0.01, max: 10_000_000, noNaN: true, noDefaultInfinity: true })

/** Generate a stage order (1-based) */
const stageOrderArb = fc.integer({ min: 1, max: 10 })

/** Generate a total number of stages in a pipeline */
const totalStagesArb = fc.integer({ min: 1, max: 10 })

/**
 * Generate a list of open leads with stage and pipeline info.
 * Each lead has a dealValue, a stage with an order, and a pipeline with total stages.
 */
const openLeadsArb = fc.array(
  fc.record({
    dealValue: dealValueArb,
    stageOrder: stageOrderArb,
    totalStages: totalStagesArb,
  }).filter(({ stageOrder, totalStages }) => stageOrder <= totalStages),
  { minLength: 0, maxLength: 20 },
)

/**
 * Generate a list of open leads where at least one has a positive deal value.
 */
const openLeadsWithPositiveValueArb = fc.tuple(
  fc.array(
    fc.record({
      dealValue: dealValueArb,
      stageOrder: stageOrderArb,
      totalStages: totalStagesArb,
    }).filter(({ stageOrder, totalStages }) => stageOrder <= totalStages),
    { minLength: 0, maxLength: 19 },
  ),
  fc.record({
    dealValue: positiveDealValueArb,
    stageOrder: stageOrderArb,
    totalStages: totalStagesArb,
  }).filter(({ stageOrder, totalStages }) => stageOrder <= totalStages),
).map(([leads, positiveLead]) => [...leads, positiveLead])

/** Build mock lead objects from generated data */
function buildMockLeads(leads: Array<{ dealValue: number; stageOrder: number; totalStages: number }>) {
  return leads.map((lead, idx) => ({
    id: `lead-${idx}`,
    dealValue: lead.dealValue,
    isClosed: false,
    deletedAt: null,
    stage: {
      id: `stage-${lead.stageOrder}`,
      order: lead.stageOrder,
      pipeline: {
        id: `pipeline-1`,
        stages: Array.from({ length: lead.totalStages }, (_, i) => ({
          id: `stage-${i + 1}`,
          order: i + 1,
        })),
      },
    },
  }))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Forecast Service - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Weighted pipeline is always ≤ total pipeline value', () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * Since win probability = stage.order / totalStages, and stage.order ≤ totalStages,
     * the win probability is always ≤ 1. Therefore weighted pipeline (sum of dealValue × winProb)
     * must always be ≤ total pipeline (sum of dealValue).
     */

    it('weighted pipeline ≤ total pipeline for any set of open leads', async () => {
      await fc.assert(
        fc.asyncProperty(
          openLeadsArb,
          async (leads) => {
            const mockLeads = buildMockLeads(leads)

            // First call returns open leads, second returns closed won leads (empty)
            mockDb.lead.findMany
              .mockResolvedValueOnce(mockLeads)
              .mockResolvedValueOnce([])

            const metrics = await calculatePipelineMetrics('org-1')

            expect(metrics.weightedPipeline).toBeLessThanOrEqual(metrics.totalPipeline + 1e-10)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('weighted pipeline equals total pipeline only when all leads are at final stage', async () => {
      // When stageOrder === totalStages, winProb = 1, so weighted = total
      const leadsAtFinalStage = [
        { dealValue: 50000, stageOrder: 5, totalStages: 5 },
        { dealValue: 30000, stageOrder: 3, totalStages: 3 },
      ]

      const mockLeads = buildMockLeads(leadsAtFinalStage)

      mockDb.lead.findMany
        .mockResolvedValueOnce(mockLeads)
        .mockResolvedValueOnce([])

      const metrics = await calculatePipelineMetrics('org-1')

      expect(metrics.weightedPipeline).toBeCloseTo(metrics.totalPipeline, 5)
    })

    it('weighted pipeline is 0 when all deal values are 0', async () => {
      const zeroValueLeads = [
        { dealValue: 0, stageOrder: 3, totalStages: 5 },
        { dealValue: 0, stageOrder: 1, totalStages: 4 },
      ]

      const mockLeads = buildMockLeads(zeroValueLeads)

      mockDb.lead.findMany
        .mockResolvedValueOnce(mockLeads)
        .mockResolvedValueOnce([])

      const metrics = await calculatePipelineMetrics('org-1')

      expect(metrics.weightedPipeline).toBe(0)
      expect(metrics.totalPipeline).toBe(0)
    })
  })

  describe('Property: AI predicted is always positive when pipeline has open deals', () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * AI predicted = 0.7 × weightedPipeline + 0.3 × monthlyRunRate.
     * When there are open deals with positive dealValue, weightedPipeline > 0
     * (since stageOrder ≥ 1 and totalStages ≥ 1, winProb ≥ 1/totalStages > 0).
     * Therefore AI predicted must be > 0.
     */

    it('AI predicted > 0 when there are open deals with positive dealValue', async () => {
      await fc.assert(
        fc.asyncProperty(
          openLeadsWithPositiveValueArb,
          async (leads) => {
            const mockLeads = buildMockLeads(leads)

            mockDb.lead.findMany
              .mockResolvedValueOnce(mockLeads)
              .mockResolvedValueOnce([]) // no closed won leads

            const metrics = await calculatePipelineMetrics('org-1')

            expect(metrics.aiPredicted).toBeGreaterThan(0)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('AI predicted is 0 when pipeline is empty', async () => {
      mockDb.lead.findMany
        .mockResolvedValueOnce([]) // no open leads
        .mockResolvedValueOnce([]) // no closed won leads

      const metrics = await calculatePipelineMetrics('org-1')

      expect(metrics.aiPredicted).toBe(0)
    })

    it('AI predicted includes monthly run rate contribution', async () => {
      // No open leads but some closed won leads
      const closedWonLeads = [
        { id: 'lead-1', dealValue: 100000, isClosed: true, deletedAt: null },
      ]

      mockDb.lead.findMany
        .mockResolvedValueOnce([]) // no open leads
        .mockResolvedValueOnce(closedWonLeads) // closed won leads

      const metrics = await calculatePipelineMetrics('org-1')

      // AI predicted = 0.7 * 0 + 0.3 * 100000 = 30000
      expect(metrics.aiPredicted).toBeCloseTo(30000, 5)
    })
  })

  describe('Property: Adding a deal never decreases total pipeline value', () => {
    /**
     * **Validates: Requirements 10.3**
     *
     * This is a metamorphic property: given a set of open leads, adding one more
     * lead with a non-negative dealValue should never decrease the total pipeline value.
     */

    it('adding a deal with non-negative value never decreases total pipeline', async () => {
      await fc.assert(
        fc.asyncProperty(
          openLeadsArb,
          fc.record({
            dealValue: dealValueArb,
            stageOrder: stageOrderArb,
            totalStages: totalStagesArb,
          }).filter(({ stageOrder, totalStages }) => stageOrder <= totalStages),
          async (existingLeads, newLead) => {
            // Calculate metrics with existing leads
            const existingMockLeads = buildMockLeads(existingLeads)
            mockDb.lead.findMany
              .mockResolvedValueOnce(existingMockLeads)
              .mockResolvedValueOnce([])

            const metricsBefore = await calculatePipelineMetrics('org-1')

            // Calculate metrics with existing leads + new lead
            const allLeads = [...existingLeads, newLead]
            const allMockLeads = buildMockLeads(allLeads)
            mockDb.lead.findMany
              .mockResolvedValueOnce(allMockLeads)
              .mockResolvedValueOnce([])

            const metricsAfter = await calculatePipelineMetrics('org-1')

            expect(metricsAfter.totalPipeline).toBeGreaterThanOrEqual(metricsBefore.totalPipeline - 1e-10)
          },
        ),
        { numRuns: 500 },
      )
    })

    it('adding a deal with positive value strictly increases total pipeline', async () => {
      await fc.assert(
        fc.asyncProperty(
          openLeadsArb,
          fc.record({
            dealValue: positiveDealValueArb,
            stageOrder: stageOrderArb,
            totalStages: totalStagesArb,
          }).filter(({ stageOrder, totalStages }) => stageOrder <= totalStages),
          async (existingLeads, newLead) => {
            // Calculate metrics with existing leads
            const existingMockLeads = buildMockLeads(existingLeads)
            mockDb.lead.findMany
              .mockResolvedValueOnce(existingMockLeads)
              .mockResolvedValueOnce([])

            const metricsBefore = await calculatePipelineMetrics('org-1')

            // Calculate metrics with existing leads + new lead
            const allLeads = [...existingLeads, newLead]
            const allMockLeads = buildMockLeads(allLeads)
            mockDb.lead.findMany
              .mockResolvedValueOnce(allMockLeads)
              .mockResolvedValueOnce([])

            const metricsAfter = await calculatePipelineMetrics('org-1')

            expect(metricsAfter.totalPipeline).toBeGreaterThan(metricsBefore.totalPipeline)
          },
        ),
        { numRuns: 500 },
      )
    })
  })

  describe('assessForecastRisk classification', () => {
    /**
     * **Validates: Requirements 10.3**
     *
     * assessForecastRisk compares team commit vs AI predicted:
     * - On Track: gap < 15%
     * - At Risk: gap 15-30%
     * - High Risk: gap > 30%
     */

    it('returns "On Track" when gap < 15%', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0, max: 0.1499, noNaN: true, noDefaultInfinity: true }),
          (aiPredicted, gapFraction) => {
            // teamCommit is within 15% of aiPredicted
            const teamCommit = aiPredicted * (1 + gapFraction)

            const risk = assessForecastRisk(teamCommit, aiPredicted)

            expect(risk).toBe('On Track')
          },
        ),
        { numRuns: 500 },
      )
    })

    it('returns "On Track" when teamCommit is below aiPredicted by < 15%', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0, max: 0.1499, noNaN: true, noDefaultInfinity: true }),
          (aiPredicted, gapFraction) => {
            const teamCommit = aiPredicted * (1 - gapFraction)

            const risk = assessForecastRisk(teamCommit, aiPredicted)

            expect(risk).toBe('On Track')
          },
        ),
        { numRuns: 500 },
      )
    })

    it('returns "At Risk" when gap is between 15% and 30%', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0.16, max: 0.29, noNaN: true, noDefaultInfinity: true }),
          (aiPredicted, gapFraction) => {
            // Use larger aiPredicted values to avoid floating point boundary issues
            const teamCommit = aiPredicted * (1 + gapFraction)

            const risk = assessForecastRisk(teamCommit, aiPredicted)

            expect(risk).toBe('At Risk')
          },
        ),
        { numRuns: 500 },
      )
    })

    it('returns "High Risk" when gap > 30%', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 100, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0.31, max: 2.0, noNaN: true, noDefaultInfinity: true }),
          (aiPredicted, gapFraction) => {
            // Use larger aiPredicted values to avoid floating point boundary issues
            const teamCommit = aiPredicted * (1 + gapFraction)

            const risk = assessForecastRisk(teamCommit, aiPredicted)

            expect(risk).toBe('High Risk')
          },
        ),
        { numRuns: 500 },
      )
    })

    it('returns "On Track" when both values are 0', () => {
      expect(assessForecastRisk(0, 0)).toBe('On Track')
    })

    it('returns "High Risk" when aiPredicted is 0 but teamCommit is positive', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 10_000_000, noNaN: true, noDefaultInfinity: true }),
          (teamCommit) => {
            const risk = assessForecastRisk(teamCommit, 0)

            expect(risk).toBe('High Risk')
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})
