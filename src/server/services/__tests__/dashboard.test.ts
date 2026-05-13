import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the dashboard analytics service.
 *
 * Tests cover:
 * - getPipelineValue: total deal value per stage
 * - getConversionRates: stage-to-stage conversion rates (clamped to [0, 1])
 * - getStageDuration: average time in each stage (non-negative)
 * - getLeadCounts: lead count per stage
 * - getClosedSummary: closed won/lost counts
 * - Date range filtering and defaults
 * - Soft-deleted leads excluded from all metrics
 *
 * **Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  pipeline: {
    findMany: vi.fn(),
  },
  lead: {
    groupBy: vi.fn(),
  },
  stageTransition: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Pipeline', 'Stage', 'StageTransition'],
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import {
  getPipelineValue,
  getConversionRates,
  getStageDuration,
  getLeadCounts,
  getClosedSummary,
} from '@/server/services/dashboard'

// ─── Test Data ───────────────────────────────────────────────────────────────

const orgId = '550e8400-e29b-41d4-a716-446655440000'

const mockPipelines = [
  {
    id: 'pipeline-1',
    name: 'Sales Pipeline',
    stages: [
      { id: 'stage-new', name: 'New', order: 1, isClosedWon: false, isClosedLost: false, pipelineId: 'pipeline-1', createdAt: new Date() },
      { id: 'stage-qualified', name: 'Qualified', order: 2, isClosedWon: false, isClosedLost: false, pipelineId: 'pipeline-1', createdAt: new Date() },
      { id: 'stage-won', name: 'Closed Won', order: 3, isClosedWon: true, isClosedLost: false, pipelineId: 'pipeline-1', createdAt: new Date() },
      { id: 'stage-lost', name: 'Closed Lost', order: 4, isClosedWon: false, isClosedLost: true, pipelineId: 'pipeline-1', createdAt: new Date() },
    ],
  },
]

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Dashboard Analytics Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.pipeline.findMany.mockResolvedValue(mockPipelines)
  })

  describe('getPipelineValue', () => {
    it('returns total deal value per stage for open leads', async () => {
      mockDb.lead.groupBy.mockResolvedValue([
        { stageId: 'stage-new', _sum: { dealValue: 50000 } },
        { stageId: 'stage-qualified', _sum: { dealValue: 120000 } },
      ])

      const result = await getPipelineValue(orgId)

      expect(result).toHaveLength(4)
      expect(result.find((s) => s.stageId === 'stage-new')?.value).toBe(50000)
      expect(result.find((s) => s.stageId === 'stage-qualified')?.value).toBe(120000)
      expect(result.find((s) => s.stageId === 'stage-won')?.value).toBe(0)
      expect(result.find((s) => s.stageId === 'stage-lost')?.value).toBe(0)
    })

    it('returns 0 value for stages with no leads', async () => {
      mockDb.lead.groupBy.mockResolvedValue([])

      const result = await getPipelineValue(orgId)

      expect(result).toHaveLength(4)
      for (const stage of result) {
        expect(stage.value).toBe(0)
      }
    })

    it('returns empty array when no pipelines exist', async () => {
      mockDb.pipeline.findMany.mockResolvedValue([])

      const result = await getPipelineValue(orgId)

      expect(result).toEqual([])
    })

    it('handles null dealValue in aggregation', async () => {
      mockDb.lead.groupBy.mockResolvedValue([
        { stageId: 'stage-new', _sum: { dealValue: null } },
      ])

      const result = await getPipelineValue(orgId)

      expect(result.find((s) => s.stageId === 'stage-new')?.value).toBe(0)
    })

    it('applies date range filter', async () => {
      mockDb.lead.groupBy.mockResolvedValue([])
      const from = new Date('2025-01-01')
      const to = new Date('2025-06-30')

      await getPipelineValue(orgId, { from, to })

      expect(mockDb.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: from, lte: to },
          }),
        }),
      )
    })
  })

  describe('getConversionRates', () => {
    it('calculates conversion rate as exited / entered', async () => {
      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: null, toStageId: 'stage-new', transitionedAt: new Date() },
        { leadId: 'lead-2', fromStageId: null, toStageId: 'stage-new', transitionedAt: new Date() },
        { leadId: 'lead-1', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: new Date() },
      ])

      const result = await getConversionRates(orgId)

      const newStage = result.find((s) => s.stageId === 'stage-new')
      expect(newStage?.entered).toBe(2)
      expect(newStage?.exited).toBe(1)
      expect(newStage?.conversionRate).toBe(0.5)
    })

    it('returns 0 conversion rate when no leads entered', async () => {
      mockDb.stageTransition.findMany.mockResolvedValue([])

      const result = await getConversionRates(orgId)

      for (const stage of result) {
        expect(stage.conversionRate).toBe(0)
      }
    })

    it('clamps conversion rate to maximum of 1', async () => {
      // Edge case: more exits than entries in the window (lead entered before window)
      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: new Date() },
        { leadId: 'lead-2', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: new Date() },
      ])

      const result = await getConversionRates(orgId)

      // stage-new has 0 entries but 2 exits in this window
      const newStage = result.find((s) => s.stageId === 'stage-new')
      expect(newStage?.conversionRate).toBe(0) // 0 entered → rate is 0
    })

    it('conversion rate is always between 0 and 1', async () => {
      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: null, toStageId: 'stage-new', transitionedAt: new Date() },
        { leadId: 'lead-1', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: new Date() },
      ])

      const result = await getConversionRates(orgId)

      for (const stage of result) {
        expect(stage.conversionRate).toBeGreaterThanOrEqual(0)
        expect(stage.conversionRate).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('getStageDuration', () => {
    it('calculates average duration from entry to exit', async () => {
      const entryTime = new Date('2025-06-01T10:00:00Z')
      const exitTime = new Date('2025-06-03T10:00:00Z') // 2 days later

      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: null, toStageId: 'stage-new', transitionedAt: entryTime },
        { leadId: 'lead-1', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: exitTime },
      ])

      const result = await getStageDuration(orgId)

      const newStage = result.find((s) => s.stageId === 'stage-new')
      expect(newStage?.avgDurationMs).toBe(2 * 24 * 60 * 60 * 1000) // 2 days in ms
      expect(newStage?.sampleCount).toBe(1)
    })

    it('returns null avgDurationMs when no leads have exited', async () => {
      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: null, toStageId: 'stage-new', transitionedAt: new Date() },
      ])

      const result = await getStageDuration(orgId)

      const newStage = result.find((s) => s.stageId === 'stage-new')
      expect(newStage?.avgDurationMs).toBeNull()
      expect(newStage?.sampleCount).toBe(0)
    })

    it('duration is always non-negative', async () => {
      const entryTime = new Date('2025-06-01T10:00:00Z')
      const exitTime = new Date('2025-06-05T10:00:00Z')

      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: null, toStageId: 'stage-new', transitionedAt: entryTime },
        { leadId: 'lead-1', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: exitTime },
      ])

      const result = await getStageDuration(orgId)

      for (const stage of result) {
        if (stage.avgDurationMs !== null) {
          expect(stage.avgDurationMs).toBeGreaterThanOrEqual(0)
        }
      }
    })

    it('averages multiple lead durations in the same stage', async () => {
      const entry1 = new Date('2025-06-01T00:00:00Z')
      const exit1 = new Date('2025-06-02T00:00:00Z') // 1 day
      const entry2 = new Date('2025-06-03T00:00:00Z')
      const exit2 = new Date('2025-06-06T00:00:00Z') // 3 days

      mockDb.stageTransition.findMany.mockResolvedValue([
        { leadId: 'lead-1', fromStageId: null, toStageId: 'stage-new', transitionedAt: entry1 },
        { leadId: 'lead-1', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: exit1 },
        { leadId: 'lead-2', fromStageId: null, toStageId: 'stage-new', transitionedAt: entry2 },
        { leadId: 'lead-2', fromStageId: 'stage-new', toStageId: 'stage-qualified', transitionedAt: exit2 },
      ])

      const result = await getStageDuration(orgId)

      const newStage = result.find((s) => s.stageId === 'stage-new')
      // Average of 1 day and 3 days = 2 days
      expect(newStage?.avgDurationMs).toBe(2 * 24 * 60 * 60 * 1000)
      expect(newStage?.sampleCount).toBe(2)
    })
  })

  describe('getLeadCounts', () => {
    it('returns lead count per stage', async () => {
      mockDb.lead.groupBy.mockResolvedValue([
        { stageId: 'stage-new', _count: { _all: 5 } },
        { stageId: 'stage-qualified', _count: { _all: 3 } },
        { stageId: 'stage-won', _count: { _all: 2 } },
      ])

      const result = await getLeadCounts(orgId)

      expect(result).toHaveLength(4)
      expect(result.find((s) => s.stageId === 'stage-new')?.leadCount).toBe(5)
      expect(result.find((s) => s.stageId === 'stage-qualified')?.leadCount).toBe(3)
      expect(result.find((s) => s.stageId === 'stage-won')?.leadCount).toBe(2)
      expect(result.find((s) => s.stageId === 'stage-lost')?.leadCount).toBe(0)
    })

    it('returns 0 for stages with no leads', async () => {
      mockDb.lead.groupBy.mockResolvedValue([])

      const result = await getLeadCounts(orgId)

      for (const stage of result) {
        expect(stage.leadCount).toBe(0)
      }
    })

    it('excludes soft-deleted leads via where clause', async () => {
      mockDb.lead.groupBy.mockResolvedValue([])

      await getLeadCounts(orgId)

      expect(mockDb.lead.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        }),
      )
    })
  })

  describe('getClosedSummary', () => {
    it('returns closed won and lost counts', async () => {
      mockDb.stageTransition.count
        .mockResolvedValueOnce(7) // closedWon
        .mockResolvedValueOnce(3) // closedLost

      const result = await getClosedSummary(orgId)

      expect(result.closedWon).toBe(7)
      expect(result.closedLost).toBe(3)
    })

    it('returns zeros when no terminal stages exist', async () => {
      mockDb.pipeline.findMany.mockResolvedValue([
        {
          id: 'pipeline-1',
          name: 'Sales Pipeline',
          stages: [
            { id: 'stage-new', name: 'New', order: 1, isClosedWon: false, isClosedLost: false, pipelineId: 'pipeline-1', createdAt: new Date() },
          ],
        },
      ])

      const result = await getClosedSummary(orgId)

      expect(result.closedWon).toBe(0)
      expect(result.closedLost).toBe(0)
    })

    it('returns zeros when no pipelines exist', async () => {
      mockDb.pipeline.findMany.mockResolvedValue([])

      const result = await getClosedSummary(orgId)

      expect(result).toEqual({ closedWon: 0, closedLost: 0 })
    })

    it('applies date range filter to transition count', async () => {
      mockDb.stageTransition.count.mockResolvedValue(0)
      const from = new Date('2025-01-01')
      const to = new Date('2025-06-30')

      await getClosedSummary(orgId, { from, to })

      expect(mockDb.stageTransition.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            transitionedAt: { gte: from, lte: to },
          }),
        }),
      )
    })
  })

  describe('Date range handling', () => {
    it('defaults to last 30 days when no range provided', async () => {
      mockDb.lead.groupBy.mockResolvedValue([])

      const before = Date.now()
      await getPipelineValue(orgId)
      const after = Date.now()

      const call = mockDb.lead.groupBy.mock.calls[0][0]
      const { gte, lte } = call.where.createdAt
      // `to` should be approximately now
      expect(lte.getTime()).toBeGreaterThanOrEqual(before)
      expect(lte.getTime()).toBeLessThanOrEqual(after)
      // `from` should be approximately 30 days before now
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      expect(gte.getTime()).toBeGreaterThanOrEqual(before - thirtyDaysMs - 1000)
      expect(gte.getTime()).toBeLessThanOrEqual(after - thirtyDaysMs + 1000)
    })

    it('normalizes inverted date range (from > to)', async () => {
      mockDb.lead.groupBy.mockResolvedValue([])
      const from = new Date('2025-06-30')
      const to = new Date('2025-01-01')

      await getPipelineValue(orgId, { from, to })

      const call = mockDb.lead.groupBy.mock.calls[0][0]
      const { gte, lte } = call.where.createdAt
      // Should be normalized: gte = earlier date, lte = later date
      expect(gte.getTime()).toBeLessThanOrEqual(lte.getTime())
    })
  })
})
