import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the assignment rule engine.
 *
 * Tests cover:
 * - Skipping evaluation when lead already has an assignee
 * - TERRITORY rule matching (company, country, state)
 * - DEAL_SIZE rule matching (min/max range)
 * - ROUND_ROBIN rule distribution via Redis counter
 * - Priority ordering (lowest number first)
 * - No match leaves lead unassigned
 *
 * **Validates: Requirements 16.4, 16.5, 16.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  assignmentRule: {
    findMany: vi.fn(),
  },
  lead: {
    update: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'AssignmentRule'],
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

import { evaluateAssignmentRules } from '@/server/services/assignment'
import type { LeadForAssignment } from '@/server/services/assignment'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Assignment Rule Engine', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'

  const baseLead: LeadForAssignment = {
    id: 'lead-1',
    assignedUserId: null,
    companyName: 'Acme Corp',
    country: 'US',
    state: 'California',
    dealValue: 50000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('skip evaluation', () => {
    it('skips evaluation entirely if lead already has an assignee', async () => {
      const lead = { ...baseLead, assignedUserId: 'existing-user' }

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBe('existing-user')
      expect(result.ruleId).toBeNull()
      expect(result.ruleType).toBeNull()
      // Should not even fetch rules
      expect(mockDb.assignmentRule.findMany).not.toHaveBeenCalled()
    })
  })

  describe('TERRITORY rule', () => {
    it('matches when lead company name contains a configured pattern', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['Acme'], userId: 'user-territory' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-territory' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-territory')
      expect(result.ruleId).toBe('rule-1')
      expect(result.ruleType).toBe('TERRITORY')
      expect(mockDb.lead.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { assignedUserId: 'user-territory' },
      })
    })

    it('matches when lead country matches a configured country', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-2',
          type: 'TERRITORY',
          priority: 1,
          config: { countries: ['US'], userId: 'user-us' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-us' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-us')
    })

    it('matches when lead state matches a configured state', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-3',
          type: 'TERRITORY',
          priority: 1,
          config: { states: ['California'], userId: 'user-ca' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-ca' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-ca')
    })

    it('performs case-insensitive matching', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-4',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['acme'], countries: ['us'], userId: 'user-ci' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-ci' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-ci')
    })

    it('does not match when no conditions are met', async () => {
      const lead = { ...baseLead, companyName: 'Other Inc', country: 'UK', state: 'London' }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-5',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['Acme'], countries: ['US'], userId: 'user-no' },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBeNull()
      expect(mockDb.lead.update).not.toHaveBeenCalled()
    })

    it('does not match when lead has null fields', async () => {
      const lead = { ...baseLead, companyName: null, country: null, state: null }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-6',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['Acme'], countries: ['US'], userId: 'user-null' },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBeNull()
    })
  })

  describe('DEAL_SIZE rule', () => {
    it('matches when deal value is within min/max range', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-1',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 10000, max: 100000, userId: 'user-mid' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-mid' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-mid')
      expect(result.ruleType).toBe('DEAL_SIZE')
    })

    it('matches when deal value equals min boundary', async () => {
      const lead = { ...baseLead, dealValue: 10000 }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-2',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 10000, max: 100000, userId: 'user-min' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...lead, assignedUserId: 'user-min' })

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBe('user-min')
    })

    it('matches when deal value equals max boundary', async () => {
      const lead = { ...baseLead, dealValue: 100000 }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-3',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 10000, max: 100000, userId: 'user-max' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...lead, assignedUserId: 'user-max' })

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBe('user-max')
    })

    it('does not match when deal value is below min', async () => {
      const lead = { ...baseLead, dealValue: 5000 }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-4',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 10000, max: 100000, userId: 'user-below' },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBeNull()
    })

    it('does not match when deal value is above max', async () => {
      const lead = { ...baseLead, dealValue: 200000 }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-5',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 10000, max: 100000, userId: 'user-above' },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBeNull()
    })

    it('does not match when lead has no deal value', async () => {
      const lead = { ...baseLead, dealValue: null }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-6',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 10000, max: 100000, userId: 'user-nodeal' },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBeNull()
    })

    it('matches with only min bound (no max)', async () => {
      const lead = { ...baseLead, dealValue: 500000 }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-7',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { min: 100000, userId: 'user-enterprise' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...lead, assignedUserId: 'user-enterprise' })

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBe('user-enterprise')
    })

    it('matches with only max bound (no min)', async () => {
      const lead = { ...baseLead, dealValue: 5000 }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-ds-8',
          type: 'DEAL_SIZE',
          priority: 1,
          config: { max: 10000, userId: 'user-small' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...lead, assignedUserId: 'user-small' })

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBe('user-small')
    })
  })

  describe('ROUND_ROBIN rule', () => {
    it('distributes leads evenly using Redis counter', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-rr-1',
          type: 'ROUND_ROBIN',
          priority: 1,
          config: { userIds: ['user-a', 'user-b', 'user-c'] },
          isActive: true,
        },
      ])
      mockRedisIncr.mockResolvedValue(1) // counter = 1, (1-1) % 3 = 0 → user-a
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-a' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-a')
      expect(mockRedisIncr).toHaveBeenCalledWith('round_robin:rule-rr-1')
    })

    it('assigns second user when counter is 2', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-rr-2',
          type: 'ROUND_ROBIN',
          priority: 1,
          config: { userIds: ['user-a', 'user-b', 'user-c'] },
          isActive: true,
        },
      ])
      mockRedisIncr.mockResolvedValue(2) // counter = 2, (2-1) % 3 = 1 → user-b
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-b' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-b')
    })

    it('wraps around when counter exceeds user count', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-rr-3',
          type: 'ROUND_ROBIN',
          priority: 1,
          config: { userIds: ['user-a', 'user-b', 'user-c'] },
          isActive: true,
        },
      ])
      mockRedisIncr.mockResolvedValue(4) // counter = 4, (4-1) % 3 = 0 → user-a
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-a' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBe('user-a')
    })

    it('does not match when userIds is empty', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-rr-4',
          type: 'ROUND_ROBIN',
          priority: 1,
          config: { userIds: [] },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBeNull()
      expect(mockRedisIncr).not.toHaveBeenCalled()
    })
  })

  describe('priority ordering', () => {
    it('evaluates rules in ascending priority order (first match wins)', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-low-priority',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['Acme'], userId: 'user-first' },
          isActive: true,
        },
        {
          id: 'rule-high-priority',
          type: 'TERRITORY',
          priority: 2,
          config: { countries: ['US'], userId: 'user-second' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...baseLead, assignedUserId: 'user-first' })

      const result = await evaluateAssignmentRules(baseLead, orgId)

      // First rule (priority 1) matches, so second rule is never evaluated
      expect(result.assignedUserId).toBe('user-first')
      expect(result.ruleId).toBe('rule-low-priority')
    })

    it('falls through to next rule when first does not match', async () => {
      const lead = { ...baseLead, companyName: 'Other Inc' }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-no-match',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['Acme'], userId: 'user-first' },
          isActive: true,
        },
        {
          id: 'rule-match',
          type: 'TERRITORY',
          priority: 2,
          config: { countries: ['US'], userId: 'user-second' },
          isActive: true,
        },
      ])
      mockDb.lead.update.mockResolvedValue({ ...lead, assignedUserId: 'user-second' })

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBe('user-second')
      expect(result.ruleId).toBe('rule-match')
    })
  })

  describe('no match', () => {
    it('returns null assignedUserId when no rules exist', async () => {
      mockDb.assignmentRule.findMany.mockResolvedValue([])

      const result = await evaluateAssignmentRules(baseLead, orgId)

      expect(result.assignedUserId).toBeNull()
      expect(result.ruleId).toBeNull()
      expect(result.ruleType).toBeNull()
      expect(mockDb.lead.update).not.toHaveBeenCalled()
    })

    it('returns null assignedUserId when no rule matches', async () => {
      const lead = { ...baseLead, companyName: 'Unknown', country: 'Mars', state: null, dealValue: null }
      mockDb.assignmentRule.findMany.mockResolvedValue([
        {
          id: 'rule-nm-1',
          type: 'TERRITORY',
          priority: 1,
          config: { companies: ['Acme'], userId: 'user-1' },
          isActive: true,
        },
        {
          id: 'rule-nm-2',
          type: 'DEAL_SIZE',
          priority: 2,
          config: { min: 10000, max: 50000, userId: 'user-2' },
          isActive: true,
        },
      ])

      const result = await evaluateAssignmentRules(lead, orgId)

      expect(result.assignedUserId).toBeNull()
      expect(mockDb.lead.update).not.toHaveBeenCalled()
    })
  })
})
