import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for the Inngest score decay function.
 *
 * Tests cover:
 * - Function configuration (id, retries, cron schedule)
 * - Returning early when no active configs exist
 * - Finding inactive leads beyond threshold
 * - Reducing scores by configured amount, clamped to [0, 100]
 * - Creating ScoreHistory entries for each decay
 * - Idempotency: skipping leads already decayed today
 * - Skipping leads with score already at 0
 *
 * **Validates: Requirements 14.3, 16.1**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockTenantDb = {
  lead: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  scoreHistory: {
    findFirst: vi.fn(),
  },
}

const mockPrisma = {
  scoreDecayConfig: {
    findMany: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockTenantDb),
  TENANT_SCOPED_MODELS: ['Lead', 'ScoreHistory', 'ScoreDecayConfig'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        return (mockPrisma as any)[prop]
      },
    },
  ),
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

const mockRecordScoreChange = vi.fn()
vi.mock('@/server/services/scoring', () => ({
  clampScore: (score: number) => Math.min(100, Math.max(0, score)),
  recordScoreChange: (...args: unknown[]) => mockRecordScoreChange(...args),
}))

vi.mock('../client', () => ({
  inngest: {
    createFunction: vi.fn((config, trigger, handler) => {
      return { config, trigger, handler }
    }),
  },
}))

// Import after mocks
import { scoreDecayFunction } from '../score-decay'

// ─── Test Helpers ────────────────────────────────────────────────────────────

const orgId = '550e8400-e29b-41d4-a716-446655440000'

function createMockStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  }
}

// Get the handler from the function definition
const handler = (scoreDecayFunction as any).handler

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Score Decay Function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('function configuration', () => {
    it('should be configured with id "score-decay"', () => {
      expect((scoreDecayFunction as any).config.id).toBe('score-decay')
    })

    it('should be configured with retries: 3', () => {
      expect((scoreDecayFunction as any).config.retries).toBe(3)
    })

    it('should be configured with daily cron at midnight UTC', () => {
      expect((scoreDecayFunction as any).trigger.cron).toBe('0 0 * * *')
    })
  })

  describe('no active configs', () => {
    it('should return early with zero counts when no active configs exist', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([])

      const result = await handler({ step: mockStep })

      expect(result).toEqual({ processed: 0, decayed: 0, skipped: 0 })
    })
  })

  describe('finding inactive leads', () => {
    it('should find leads inactive beyond configured threshold', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 5,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 50 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      await handler({ step: mockStep })

      // Verify findMany was called with correct inactivity filter
      expect(mockTenantDb.lead.findMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          score: { gt: 0 },
          OR: [
            { lastActivityAt: { lt: expect.any(Date) } },
            { lastActivityAt: null },
          ],
        },
        select: {
          id: true,
          score: true,
        },
      })

      // Verify the threshold date is 7 days ago
      const callArgs = mockTenantDb.lead.findMany.mock.calls[0][0]
      const thresholdDate = callArgs.where.OR[0].lastActivityAt.lt
      const expectedDate = new Date('2026-06-08T00:00:00.000Z')
      expect(thresholdDate.getTime()).toBe(expectedDate.getTime())
    })

    it('should not include soft-deleted leads', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 5,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([])

      await handler({ step: mockStep })

      const callArgs = mockTenantDb.lead.findMany.mock.calls[0][0]
      expect(callArgs.where.deletedAt).toBeNull()
    })

    it('should only include leads with score > 0', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 5,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([])

      await handler({ step: mockStep })

      const callArgs = mockTenantDb.lead.findMany.mock.calls[0][0]
      expect(callArgs.where.score).toEqual({ gt: 0 })
    })
  })

  describe('score reduction', () => {
    it('should reduce lead score by configured pointReduction', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 10,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 75 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      const result = await handler({ step: mockStep })

      expect(mockTenantDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { score: 65 },
      })
      expect(result.decayed).toBe(1)
    })

    it('should clamp score to 0 when reduction exceeds current score', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 20,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 5 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      await handler({ step: mockStep })

      expect(mockTenantDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { score: 0 },
      })
    })

    it('should process multiple leads in one organization', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 5,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 80 },
        { id: 'lead-2', score: 30 },
        { id: 'lead-3', score: 3 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      const result = await handler({ step: mockStep })

      expect(mockTenantDb.lead.update).toHaveBeenCalledTimes(3)
      expect(mockTenantDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { score: 75 },
      })
      expect(mockTenantDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-2' },
        data: { score: 25 },
      })
      expect(mockTenantDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-3' },
        data: { score: 0 },
      })
      expect(result.decayed).toBe(3)
    })
  })

  describe('ScoreHistory entries', () => {
    it('should create ScoreHistory entry with reason "decay" for each decayed lead', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 10,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 60 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      await handler({ step: mockStep })

      expect(mockRecordScoreChange).toHaveBeenCalledWith(
        'lead-1',
        60,
        50,
        'decay',
        orgId,
      )
    })
  })

  describe('idempotency', () => {
    it('should skip leads that already have a decay entry for today', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 10,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 50 },
        { id: 'lead-2', score: 40 },
      ])
      // lead-1 already decayed today, lead-2 has not
      mockTenantDb.scoreHistory.findFirst
        .mockResolvedValueOnce({ id: 'history-1', reason: 'decay' })
        .mockResolvedValueOnce(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      const result = await handler({ step: mockStep })

      // Only lead-2 should be updated
      expect(mockTenantDb.lead.update).toHaveBeenCalledTimes(1)
      expect(mockTenantDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-2' },
        data: { score: 30 },
      })
      expect(result.decayed).toBe(1)
      expect(result.skipped).toBe(1)
    })

    it('should check ScoreHistory with today start date for idempotency', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 5,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 50 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      await handler({ step: mockStep })

      expect(mockTenantDb.scoreHistory.findFirst).toHaveBeenCalledWith({
        where: {
          leadId: 'lead-1',
          reason: 'decay',
          createdAt: { gte: new Date('2026-06-15T00:00:00.000Z') },
        },
      })
    })

    it('should produce same result when run twice in same day', async () => {
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 10,
          organizationId: orgId,
        },
      ])

      // First run: lead has score 50, no existing decay
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 50 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      const result1 = await handler({ step: mockStep })
      expect(result1.decayed).toBe(1)

      vi.clearAllMocks()

      // Second run: lead now has score 40, but decay entry exists for today
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 10,
          organizationId: orgId,
        },
      ])
      mockTenantDb.lead.findMany.mockResolvedValue([
        { id: 'lead-1', score: 40 },
      ])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue({
        id: 'history-1',
        reason: 'decay',
      })

      const result2 = await handler({ step: mockStep })
      expect(result2.skipped).toBe(1)
      expect(result2.decayed).toBe(0)
      expect(mockTenantDb.lead.update).not.toHaveBeenCalled()
    })
  })

  describe('multiple organizations', () => {
    it('should process decay for multiple organizations independently', async () => {
      const orgId2 = '660e8400-e29b-41d4-a716-446655440001'
      const mockStep = createMockStep()
      mockPrisma.scoreDecayConfig.findMany.mockResolvedValue([
        {
          id: 'config-1',
          inactivityDays: 7,
          pointReduction: 5,
          organizationId: orgId,
        },
        {
          id: 'config-2',
          inactivityDays: 14,
          pointReduction: 10,
          organizationId: orgId2,
        },
      ])
      mockTenantDb.lead.findMany
        .mockResolvedValueOnce([{ id: 'lead-1', score: 80 }])
        .mockResolvedValueOnce([{ id: 'lead-2', score: 60 }])
      mockTenantDb.scoreHistory.findFirst.mockResolvedValue(null)
      mockTenantDb.lead.update.mockResolvedValue({})
      mockRecordScoreChange.mockResolvedValue(undefined)

      const result = await handler({ step: mockStep })

      expect(result.processed).toBe(2)
      expect(result.decayed).toBe(2)
    })
  })
})
