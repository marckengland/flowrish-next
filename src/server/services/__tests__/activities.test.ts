import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the activity service.
 *
 * Tests cover:
 * - Creating activities with different types (CALL, MEETING, NOTE, EMAIL, FILE_ATTACHMENT)
 * - Updating lead's lastActivityAt on activity creation
 * - Retrieving activities sorted by createdAt descending
 * - Error handling for non-existent leads
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  activity: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Activity'],
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { createActivity, getActivitiesByLead } from '@/server/services/activities'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Activity Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'
  const leadId = '770e8400-e29b-41d4-a716-446655440002'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createActivity', () => {
    it('creates a NOTE activity and updates lastActivityAt', async () => {
      const lead = { id: leadId, deletedAt: null }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.create.mockResolvedValue({
        id: 'activity-1',
        type: 'NOTE',
        leadId,
        createdById: userId,
        notes: 'Test note',
        createdAt: new Date(),
      })
      mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

      const result = await createActivity(
        { type: 'NOTE', leadId, notes: 'Test note' },
        userId,
        orgId,
      )

      expect(result.type).toBe('NOTE')
      expect(result.leadId).toBe(leadId)
      expect(result.notes).toBe('Test note')
      expect(mockDb.lead.update).toHaveBeenCalledWith({
        where: { id: leadId },
        data: { lastActivityAt: expect.any(Date) },
      })
    })

    it('creates a CALL activity with callDate and callDuration', async () => {
      const lead = { id: leadId, deletedAt: null }
      const callDate = new Date('2025-06-01T10:00:00Z')
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'activity-2', ...data, createdAt: new Date() }),
      )
      mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

      const result = await createActivity(
        { type: 'CALL', leadId, callDate: callDate.toISOString(), callDuration: 300 },
        userId,
        orgId,
      )

      expect(result.type).toBe('CALL')
      expect(result.callDate).toEqual(callDate)
      expect(result.callDuration).toBe(300)
    })

    it('creates a MEETING activity with meetingDate and attendees', async () => {
      const lead = { id: leadId, deletedAt: null }
      const meetingDate = new Date('2025-06-15T14:00:00Z')
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'activity-3', ...data, createdAt: new Date() }),
      )
      mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

      const result = await createActivity(
        {
          type: 'MEETING',
          leadId,
          meetingDate: meetingDate.toISOString(),
          attendees: ['Alice', 'Bob'],
        },
        userId,
        orgId,
      )

      expect(result.type).toBe('MEETING')
      expect(result.meetingDate).toEqual(meetingDate)
      expect(result.attendees).toBe(JSON.stringify(['Alice', 'Bob']))
    })

    it('creates an EMAIL activity', async () => {
      const lead = { id: leadId, deletedAt: null }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'activity-4', ...data, createdAt: new Date() }),
      )
      mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

      const result = await createActivity(
        { type: 'EMAIL', leadId, notes: 'Sent follow-up email' },
        userId,
        orgId,
      )

      expect(result.type).toBe('EMAIL')
      expect(result.notes).toBe('Sent follow-up email')
    })

    it('creates a FILE_ATTACHMENT activity', async () => {
      const lead = { id: leadId, deletedAt: null }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'activity-5', ...data, createdAt: new Date() }),
      )
      mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

      const result = await createActivity(
        { type: 'FILE_ATTACHMENT', leadId, notes: 'Attached proposal.pdf' },
        userId,
        orgId,
      )

      expect(result.type).toBe('FILE_ATTACHMENT')
    })

    it('throws LEAD_NOT_FOUND when lead does not exist', async () => {
      mockDb.lead.findFirst.mockResolvedValue(null)

      await expect(
        createActivity({ type: 'NOTE', leadId, notes: 'Test' }, userId, orgId),
      ).rejects.toMatchObject({
        code: 'LEAD_NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws LEAD_NOT_FOUND when lead is soft-deleted', async () => {
      mockDb.lead.findFirst.mockResolvedValue(null) // deletedAt filter excludes it

      await expect(
        createActivity({ type: 'NOTE', leadId, notes: 'Test' }, userId, orgId),
      ).rejects.toMatchObject({
        code: 'LEAD_NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws validation error for CALL without callDate', async () => {
      await expect(
        createActivity({ type: 'CALL', leadId }, userId, orgId),
      ).rejects.toThrow()
    })

    it('throws validation error for MEETING without meetingDate', async () => {
      await expect(
        createActivity({ type: 'MEETING', leadId }, userId, orgId),
      ).rejects.toThrow()
    })
  })

  describe('getActivitiesByLead', () => {
    it('returns activities sorted by createdAt descending', async () => {
      const lead = { id: leadId, deletedAt: null }
      const activities = [
        { id: 'a3', type: 'NOTE', leadId, createdAt: new Date('2025-06-03') },
        { id: 'a2', type: 'CALL', leadId, createdAt: new Date('2025-06-02') },
        { id: 'a1', type: 'EMAIL', leadId, createdAt: new Date('2025-06-01') },
      ]

      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findMany.mockResolvedValue(activities)

      const result = await getActivitiesByLead(leadId, orgId)

      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('a3')
      expect(result[1].id).toBe('a2')
      expect(result[2].id).toBe('a1')
    })

    it('passes correct orderBy to Prisma', async () => {
      const lead = { id: leadId, deletedAt: null }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findMany.mockResolvedValue([])

      await getActivitiesByLead(leadId, orgId)

      expect(mockDb.activity.findMany).toHaveBeenCalledWith({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
      })
    })

    it('throws LEAD_NOT_FOUND when lead does not exist', async () => {
      mockDb.lead.findFirst.mockResolvedValue(null)

      await expect(getActivitiesByLead(leadId, orgId)).rejects.toMatchObject({
        code: 'LEAD_NOT_FOUND',
        statusCode: 404,
      })
    })

    it('returns empty array when lead has no activities', async () => {
      const lead = { id: leadId, deletedAt: null }
      mockDb.lead.findFirst.mockResolvedValue(lead)
      mockDb.activity.findMany.mockResolvedValue([])

      const result = await getActivitiesByLead(leadId, orgId)

      expect(result).toEqual([])
    })
  })
})
