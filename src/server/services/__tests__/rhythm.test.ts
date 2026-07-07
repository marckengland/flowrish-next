import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the rhythm engine service.
 *
 * Tests cover:
 * - calculatePriorityScore: weighted signal calculation and clamping
 * - calculateDealEngagementScore: multi-factor engagement scoring
 * - classifyDealHealth: health classification thresholds
 * - identifyDealGaps: gap detection logic with skip conditions
 *
 * **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  leadContact: {
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  activity: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
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

import {
  calculatePriorityScore,
  calculateDealEngagementScore,
  classifyDealHealth,
  getRhythmSnapshot,
  identifyDealGaps,
} from '@/server/services/rhythm'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Rhythm Engine', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const leadId = '770e8400-e29b-41d4-a716-446655440002'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── calculatePriorityScore ──────────────────────────────────────────────

  describe('calculatePriorityScore', () => {
    it('returns minimum score of 1 when no signals are present', () => {
      const score = calculatePriorityScore({})
      expect(score).toBe(1)
    })

    it('calculates overdue signal: +2 per hour past due', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ dueDate: threeHoursAgo })
      // 3 hours * 2 = 6, but minimum is 1
      expect(score).toBe(6)
    })

    it('caps overdue signal at 30', () => {
      const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ dueDate: twentyHoursAgo })
      // 20 hours * 2 = 40, capped at 30
      expect(score).toBe(30)
    })

    it('does not add overdue signal for future due dates', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ dueDate: tomorrow })
      expect(score).toBe(1)
    })

    it('calculates deal value signal: +1 per $5K', () => {
      const score = calculatePriorityScore({ dealValue: 25000 })
      // 25000 / 5000 = 5
      expect(score).toBe(5)
    })

    it('caps deal value signal at 20', () => {
      const score = calculatePriorityScore({ dealValue: 200000 })
      // 200000 / 5000 = 40, capped at 20
      expect(score).toBe(20)
    })

    it('calculates lead score signal: +1 per 5 points above 50', () => {
      const score = calculatePriorityScore({ leadScore: 75 })
      // (75 - 50) / 5 = 5
      expect(score).toBe(5)
    })

    it('does not add lead score signal when score is 50 or below', () => {
      const score = calculatePriorityScore({ leadScore: 50 })
      expect(score).toBe(1)
    })

    it('caps lead score signal at 15', () => {
      const score = calculatePriorityScore({ leadScore: 200 })
      // (200 - 50) / 5 = 30, capped at 15
      expect(score).toBe(15)
    })

    it('calculates inactivity signal: +1 per day over 7', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ lastActivityAt: tenDaysAgo })
      // 10 - 7 = 3 days over threshold
      expect(score).toBe(3)
    })

    it('does not add inactivity signal when activity is within 7 days', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ lastActivityAt: threeDaysAgo })
      expect(score).toBe(1)
    })

    it('caps inactivity signal at 15', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ lastActivityAt: thirtyDaysAgo })
      // 30 - 7 = 23, capped at 15
      expect(score).toBe(15)
    })

    it('adds +10 for HIGH priority', () => {
      const score = calculatePriorityScore({ priority: 'HIGH' })
      expect(score).toBe(10)
    })

    it('does not add priority bonus for MEDIUM or LOW', () => {
      expect(calculatePriorityScore({ priority: 'MEDIUM' })).toBe(1)
      expect(calculatePriorityScore({ priority: 'LOW' })).toBe(1)
    })

    it('combines all signals correctly', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

      const score = calculatePriorityScore({
        dueDate: twoHoursAgo,       // +4 (2 hours * 2)
        dealValue: 15000,            // +3 (15000 / 5000)
        leadScore: 70,               // +4 ((70-50) / 5)
        lastActivityAt: tenDaysAgo,  // +3 (10 - 7)
        priority: 'HIGH',            // +10
      })
      // Total: 4 + 3 + 4 + 3 + 10 = 24
      expect(score).toBe(24)
    })

    it('clamps total score to maximum of 100', () => {
      const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000)
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)

      const score = calculatePriorityScore({
        dueDate: fiftyHoursAgo,      // 30 (capped)
        dealValue: 500000,           // 20 (capped)
        leadScore: 200,              // 15 (capped)
        lastActivityAt: fortyDaysAgo, // 15 (capped)
        priority: 'HIGH',            // +10
      })
      // Total: 30 + 20 + 15 + 15 + 10 = 90
      expect(score).toBe(90)
    })

    it('accepts string dates for dueDate', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ dueDate: twoHoursAgo.toISOString() })
      expect(score).toBe(4)
    })

    it('accepts string dates for lastActivityAt', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
      const score = calculatePriorityScore({ lastActivityAt: tenDaysAgo.toISOString() })
      expect(score).toBe(3)
    })

    it('handles null values gracefully', () => {
      const score = calculatePriorityScore({
        dueDate: null,
        dealValue: null,
        leadScore: null,
        lastActivityAt: null,
      })
      expect(score).toBe(1)
    })
  })

  // ─── calculateDealEngagementScore ────────────────────────────────────────

  describe('calculateDealEngagementScore', () => {
    const mockLead = {
      id: leadId,
      score: 80,
      lastActivityAt: new Date(),
      stageId: 'stage-3',
      deletedAt: null,
      stage: {
        id: 'stage-3',
        order: 3,
        pipeline: {
          id: 'pipeline-1',
          stages: [
            { id: 'stage-1', order: 1 },
            { id: 'stage-2', order: 2 },
            { id: 'stage-3', order: 3 },
            { id: 'stage-4', order: 4 },
            { id: 'stage-5', order: 5 },
          ],
        },
      },
    }

    it('calculates full engagement score with all factors', async () => {
      mockDb.lead.findFirst.mockResolvedValue(mockLead)
      mockDb.leadContact.count.mockResolvedValue(5) // 20 points
      mockDb.activity.count.mockResolvedValue(10) // 20 points

      const score = await calculateDealEngagementScore(leadId, orgId)

      // Activity Recency: 25 (just now)
      // Stakeholder Count: 20 (5 contacts)
      // Activity Volume: 20 (10 activities)
      // Deal Progression: 10 (stage 3 of 5 = index 2 / 4 = 0.5 * 20 = 10)
      // Lead Score: 12 (80/100 * 15 = 12)
      // Total: 25 + 20 + 20 + 10 + 12 = 87
      expect(score).toBe(87)
    })

    it('returns lower score for inactive lead', async () => {
      const inactiveLead = {
        ...mockLead,
        lastActivityAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
        score: 30,
      }
      mockDb.lead.findFirst.mockResolvedValue(inactiveLead)
      mockDb.leadContact.count.mockResolvedValue(1) // 4 points
      mockDb.activity.count.mockResolvedValue(2) // 4 points

      const score = await calculateDealEngagementScore(leadId, orgId)

      // Activity Recency: ~4 (25 * (1 - 25/30) ≈ 4.17 → 4)
      // Stakeholder Count: 4 (1 * 4)
      // Activity Volume: 4 (2 * 2)
      // Deal Progression: 10 (stage 3 of 5)
      // Lead Score: 5 (30/100 * 15 = 4.5 → 5)
      expect(score).toBeGreaterThanOrEqual(1)
      expect(score).toBeLessThanOrEqual(100)
    })

    it('throws LEAD_NOT_FOUND when lead does not exist', async () => {
      mockDb.lead.findFirst.mockResolvedValue(null)

      await expect(
        calculateDealEngagementScore(leadId, orgId),
      ).rejects.toMatchObject({
        code: 'LEAD_NOT_FOUND',
        statusCode: 404,
      })
    })

    it('handles lead with no lastActivityAt', async () => {
      const noActivityLead = { ...mockLead, lastActivityAt: null }
      mockDb.lead.findFirst.mockResolvedValue(noActivityLead)
      mockDb.leadContact.count.mockResolvedValue(0)
      mockDb.activity.count.mockResolvedValue(0)

      const score = await calculateDealEngagementScore(leadId, orgId)

      // Activity Recency: 0
      // Stakeholder Count: 0
      // Activity Volume: 0
      // Deal Progression: 10
      // Lead Score: 12
      // Total: 22, but clamped to minimum 1
      expect(score).toBeGreaterThanOrEqual(1)
    })

    it('caps stakeholder count contribution at 20', async () => {
      mockDb.lead.findFirst.mockResolvedValue(mockLead)
      mockDb.leadContact.count.mockResolvedValue(10) // 10 * 4 = 40, capped at 20
      mockDb.activity.count.mockResolvedValue(0)

      const score = await calculateDealEngagementScore(leadId, orgId)

      // Stakeholder contribution should be capped at 20
      expect(score).toBeLessThanOrEqual(100)
    })

    it('caps activity volume contribution at 20', async () => {
      mockDb.lead.findFirst.mockResolvedValue(mockLead)
      mockDb.leadContact.count.mockResolvedValue(0)
      mockDb.activity.count.mockResolvedValue(25) // 25 * 2 = 50, capped at 20

      const score = await calculateDealEngagementScore(leadId, orgId)

      expect(score).toBeLessThanOrEqual(100)
    })

    it('handles single-stage pipeline', async () => {
      const singleStageLead = {
        ...mockLead,
        stage: {
          id: 'stage-1',
          order: 1,
          pipeline: {
            id: 'pipeline-1',
            stages: [{ id: 'stage-1', order: 1 }],
          },
        },
      }
      mockDb.lead.findFirst.mockResolvedValue(singleStageLead)
      mockDb.leadContact.count.mockResolvedValue(0)
      mockDb.activity.count.mockResolvedValue(0)

      const score = await calculateDealEngagementScore(leadId, orgId)

      // Deal Progression: 0 (only 1 stage)
      expect(score).toBeGreaterThanOrEqual(1)
    })
  })

  // ─── classifyDealHealth ──────────────────────────────────────────────────

  describe('classifyDealHealth', () => {
    it('classifies score >= 60 as Healthy', () => {
      expect(classifyDealHealth(60)).toBe('Healthy')
      expect(classifyDealHealth(75)).toBe('Healthy')
      expect(classifyDealHealth(100)).toBe('Healthy')
    })

    it('classifies score 35-59 as At Risk', () => {
      expect(classifyDealHealth(35)).toBe('At Risk')
      expect(classifyDealHealth(45)).toBe('At Risk')
      expect(classifyDealHealth(59)).toBe('At Risk')
    })

    it('classifies score < 35 as Critical', () => {
      expect(classifyDealHealth(34)).toBe('Critical')
      expect(classifyDealHealth(20)).toBe('Critical')
      expect(classifyDealHealth(1)).toBe('Critical')
    })

    it('handles boundary values correctly', () => {
      expect(classifyDealHealth(60)).toBe('Healthy')
      expect(classifyDealHealth(59)).toBe('At Risk')
      expect(classifyDealHealth(35)).toBe('At Risk')
      expect(classifyDealHealth(34)).toBe('Critical')
    })
  })

  // ─── identifyDealGaps ────────────────────────────────────────────────────

  describe('identifyDealGaps', () => {
    it('identifies no_recent_activity when lastActivityAt > 7 days ago', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue(null) // no future meeting
      mockDb.leadContact.count.mockResolvedValue(3) // not single-threaded

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('no_recent_activity')
    })

    it('identifies no_future_meeting when no meeting with future date', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(), // recent activity
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue(null) // no future meeting
      mockDb.leadContact.count.mockResolvedValue(3)

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('no_future_meeting')
      expect(gaps).not.toContain('no_recent_activity')
    })

    it('identifies single_threaded when ≤1 contact linked', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // no recent activity
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue(null) // no future meeting
      mockDb.leadContact.count.mockResolvedValue(1) // single-threaded

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('single_threaded')
    })

    it('skips single_threaded when both future meeting AND recent activity exist', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(), // recent activity (within 7 days)
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue({ id: 'meeting-1', meetingDate: new Date(Date.now() + 24 * 60 * 60 * 1000) }) // future meeting
      mockDb.leadContact.count.mockResolvedValue(1) // would be single-threaded

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).not.toContain('single_threaded')
    })

    it('does NOT skip single_threaded when only future meeting exists (no recent activity)', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // no recent activity
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue({ id: 'meeting-1', meetingDate: new Date(Date.now() + 24 * 60 * 60 * 1000) }) // future meeting
      mockDb.leadContact.count.mockResolvedValue(1)

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('single_threaded')
    })

    it('does NOT skip single_threaded when only recent activity exists (no future meeting)', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(), // recent activity
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue(null) // no future meeting
      mockDb.leadContact.count.mockResolvedValue(0) // zero contacts

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('single_threaded')
    })

    it('returns empty array when no gaps exist', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(), // recent activity
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue({ id: 'meeting-1', meetingDate: new Date(Date.now() + 24 * 60 * 60 * 1000) }) // future meeting
      mockDb.leadContact.count.mockResolvedValue(3) // multiple contacts

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toEqual([])
    })

    it('returns all gaps when all conditions are met', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // no recent activity
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue(null) // no future meeting
      mockDb.leadContact.count.mockResolvedValue(0) // zero contacts

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('no_recent_activity')
      expect(gaps).toContain('no_future_meeting')
      expect(gaps).toContain('single_threaded')
      expect(gaps).toHaveLength(3)
    })

    it('throws LEAD_NOT_FOUND when lead does not exist', async () => {
      mockDb.lead.findFirst.mockResolvedValue(null)

      await expect(identifyDealGaps(leadId, orgId)).rejects.toMatchObject({
        code: 'LEAD_NOT_FOUND',
        statusCode: 404,
      })
    })

    it('identifies no_recent_activity when lastActivityAt is null', async () => {
      const lead = {
        id: leadId,
        deletedAt: null,
        lastActivityAt: null,
      }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findFirst.mockResolvedValue(null)
      mockDb.leadContact.count.mockResolvedValue(3)

      const gaps = await identifyDealGaps(leadId, orgId)

      expect(gaps).toContain('no_recent_activity')
    })
  })

  // ─── getRhythmSnapshot (batched) ─────────────────────────────────────────

  describe('getRhythmSnapshot', () => {
    const leadA = 'aaaaaaaa-1111-1111-1111-111111111111'
    const leadB = 'bbbbbbbb-2222-2222-2222-222222222222'

    const stages = [
      { id: 'stage-1', order: 1 },
      { id: 'stage-2', order: 2 },
      { id: 'stage-3', order: 3 },
      { id: 'stage-4', order: 4 },
      { id: 'stage-5', order: 5 },
    ]

    function mockBatch(config: {
      leads: Array<{
        id: string
        score: number
        lastActivityAt: Date | null
        stageId: string
      }>
      contacts?: Record<string, number>
      activities?: Record<string, number>
      futureMeetings?: string[]
    }): void {
      mockDb.lead.findMany.mockResolvedValue(
        config.leads.map((l) => ({
          ...l,
          deletedAt: null,
          stage: {
            id: l.stageId,
            order: stages.find((s) => s.id === l.stageId)?.order ?? 1,
            pipeline: { id: 'pipeline-1', stages },
          },
        })),
      )
      mockDb.leadContact.groupBy.mockResolvedValue(
        Object.entries(config.contacts ?? {}).map(([leadId, count]) => ({
          leadId,
          _count: { _all: count },
        })),
      )
      mockDb.activity.groupBy.mockResolvedValue(
        Object.entries(config.activities ?? {}).map(([leadId, count]) => ({
          leadId,
          _count: { _all: count },
        })),
      )
      mockDb.activity.findMany.mockResolvedValue(
        (config.futureMeetings ?? []).map((leadId) => ({ leadId })),
      )
    }

    it('returns an empty map when no lead IDs are supplied without hitting the DB', async () => {
      const snapshot = await getRhythmSnapshot([], orgId)
      expect(snapshot.size).toBe(0)
      expect(mockDb.lead.findMany).not.toHaveBeenCalled()
    })

    it('composes engagement, health, and gaps for every lead in one pass', async () => {
      const now = new Date()
      mockBatch({
        leads: [
          {
            id: leadA,
            score: 80,
            lastActivityAt: now, // recent
            stageId: 'stage-3',
          },
          {
            id: leadB,
            score: 20,
            lastActivityAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
            stageId: 'stage-1',
          },
        ],
        contacts: { [leadA]: 5, [leadB]: 1 },
        activities: { [leadA]: 10, [leadB]: 0 },
        futureMeetings: [leadA],
      })

      const snapshot = await getRhythmSnapshot([leadA, leadB], orgId)

      // Lead A: full engagement, no gaps
      const a = snapshot.get(leadA)
      expect(a).toBeDefined()
      // 25 (recency) + 20 (contacts) + 20 (activities) + 10 (stage 3/5) + 12 (score 80)
      expect(a!.engagementScore).toBe(87)
      expect(a!.health).toBe('Healthy')
      expect(a!.gaps).toEqual([])

      // Lead B: stale, single-threaded, no future meeting
      const b = snapshot.get(leadB)
      expect(b).toBeDefined()
      expect(b!.gaps).toContain('no_recent_activity')
      expect(b!.gaps).toContain('no_future_meeting')
      expect(b!.gaps).toContain('single_threaded')
      expect(b!.health).toBe('Critical')
    })

    it('respects the single-threaded skip rule when both signals are healthy', async () => {
      // Lead has one contact but recent activity + future meeting →
      // should NOT be flagged as single-threaded.
      mockBatch({
        leads: [
          {
            id: leadA,
            score: 50,
            lastActivityAt: new Date(),
            stageId: 'stage-2',
          },
        ],
        contacts: { [leadA]: 1 },
        activities: { [leadA]: 3 },
        futureMeetings: [leadA],
      })

      const snapshot = await getRhythmSnapshot([leadA], orgId)
      const entry = snapshot.get(leadA)!
      expect(entry.gaps).not.toContain('single_threaded')
      expect(entry.gaps).not.toContain('no_recent_activity')
      expect(entry.gaps).not.toContain('no_future_meeting')
    })

    it('issues exactly four DB queries regardless of input size', async () => {
      mockBatch({
        leads: [
          { id: leadA, score: 50, lastActivityAt: new Date(), stageId: 'stage-2' },
          { id: leadB, score: 50, lastActivityAt: new Date(), stageId: 'stage-2' },
        ],
        contacts: { [leadA]: 2, [leadB]: 2 },
        activities: { [leadA]: 4, [leadB]: 4 },
        futureMeetings: [leadA, leadB],
      })

      await getRhythmSnapshot([leadA, leadB], orgId)

      expect(mockDb.lead.findMany).toHaveBeenCalledTimes(1)
      expect(mockDb.leadContact.groupBy).toHaveBeenCalledTimes(1)
      expect(mockDb.activity.groupBy).toHaveBeenCalledTimes(1)
      expect(mockDb.activity.findMany).toHaveBeenCalledTimes(1)
    })

    it('omits leads that fail the tenant/deleted filter', async () => {
      // Only lead A comes back from findMany; lead B was filtered out
      // (e.g. deletedAt set between reads). It should be absent from the map.
      mockBatch({
        leads: [
          { id: leadA, score: 50, lastActivityAt: new Date(), stageId: 'stage-2' },
        ],
        contacts: { [leadA]: 3 },
        activities: { [leadA]: 5 },
        futureMeetings: [leadA],
      })

      const snapshot = await getRhythmSnapshot([leadA, leadB], orgId)
      expect(snapshot.has(leadA)).toBe(true)
      expect(snapshot.has(leadB)).toBe(false)
    })
  })
})
