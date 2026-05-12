import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the audit logging service.
 *
 * Tests cover:
 * - logAudit: persists entries with expected fields
 * - logAudit: non-blocking — swallows errors so primary operation is not disrupted
 * - logAudit: supports all AuditAction types (CREATE, UPDATE, DELETE, LOGIN,
 *   LOGOUT, EXPORT, IMPORT)
 * - getAuditLog: retrieves entries ordered by createdAt desc
 * - getAuditLog: filters by entityType, userId, action, and date range
 * - getAuditLog: paginates correctly
 *
 * **Validates: Requirements 20.1, 20.2, 20.3**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  auditEntry: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { logAudit, getAuditLog } from '@/server/services/audit'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Audit Logging Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'
  const entityId = '770e8400-e29b-41d4-a716-446655440002'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── logAudit ────────────────────────────────────────────────────────────

  describe('logAudit', () => {
    it('persists an audit entry with the expected fields', async () => {
      mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-1' })

      await logAudit('CREATE', 'Lead', entityId, userId, orgId)

      expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(1)
      expect(mockDb.auditEntry.create).toHaveBeenCalledWith({
        data: {
          userId,
          action: 'CREATE',
          entityType: 'Lead',
          entityId,
          changes: null,
        },
      })
    })

    it('stores provided metadata as the changes field', async () => {
      mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-1' })

      const metadata = {
        firstName: { old: 'Alice', new: 'Alicia' },
      }

      await logAudit('UPDATE', 'Lead', entityId, userId, orgId, metadata)

      expect(mockDb.auditEntry.create).toHaveBeenCalledWith({
        data: {
          userId,
          action: 'UPDATE',
          entityType: 'Lead',
          entityId,
          changes: metadata,
        },
      })
    })

    it('supports all AuditAction types', async () => {
      mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-1' })

      const actions = [
        'CREATE',
        'UPDATE',
        'DELETE',
        'LOGIN',
        'LOGOUT',
        'EXPORT',
        'IMPORT',
      ] as const

      for (const action of actions) {
        await logAudit(action, 'Session', entityId, userId, orgId)
      }

      expect(mockDb.auditEntry.create).toHaveBeenCalledTimes(actions.length)
      for (let i = 0; i < actions.length; i++) {
        expect(mockDb.auditEntry.create.mock.calls[i][0].data.action).toBe(
          actions[i],
        )
      }
    })

    it('does not rethrow when the underlying create fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      mockDb.auditEntry.create.mockRejectedValue(new Error('DB down'))

      // Must resolve (not reject) — audit failures cannot block callers.
      await expect(
        logAudit('CREATE', 'Lead', entityId, userId, orgId),
      ).resolves.toBeUndefined()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('can be fire-and-forget (caller does not need to await)', () => {
      mockDb.auditEntry.create.mockResolvedValue({ id: 'audit-1' })

      // Call without awaiting — should not throw synchronously.
      expect(() => {
        void logAudit('CREATE', 'Lead', entityId, userId, orgId)
      }).not.toThrow()
    })
  })

  // ─── getAuditLog ─────────────────────────────────────────────────────────

  describe('getAuditLog', () => {
    const makeEntry = (overrides: Record<string, unknown> = {}) => ({
      id: 'audit-1',
      userId,
      action: 'CREATE' as const,
      entityType: 'Lead',
      entityId,
      changes: null,
      organizationId: orgId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    })

    it('returns entries ordered by createdAt descending with default pagination', async () => {
      const entries = [makeEntry()]
      mockDb.auditEntry.findMany.mockResolvedValue(entries)
      mockDb.auditEntry.count.mockResolvedValue(1)

      const result = await getAuditLog(orgId)

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 50,
      })
      expect(result.entries).toEqual(entries)
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 50,
        total: 1,
        totalPages: 1,
      })
    })

    it('filters by entityType', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      await getAuditLog(orgId, { entityType: 'Lead' })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { entityType: 'Lead' } }),
      )
    })

    it('filters by userId', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      await getAuditLog(orgId, { userId })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      )
    })

    it('filters by action', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      await getAuditLog(orgId, { action: 'LOGIN' })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { action: 'LOGIN' } }),
      )
    })

    it('filters by date range (fromDate only)', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      const fromDate = new Date('2026-01-01T00:00:00Z')
      await getAuditLog(orgId, { fromDate })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: { gte: fromDate } },
        }),
      )
    })

    it('filters by date range (toDate only)', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      const toDate = new Date('2026-02-01T00:00:00Z')
      await getAuditLog(orgId, { toDate })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: { lt: toDate } },
        }),
      )
    })

    it('filters by date range (both bounds)', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      const fromDate = new Date('2026-01-01T00:00:00Z')
      const toDate = new Date('2026-02-01T00:00:00Z')
      await getAuditLog(orgId, { fromDate, toDate })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { createdAt: { gte: fromDate, lt: toDate } },
        }),
      )
    })

    it('combines multiple filters with AND semantics', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      const fromDate = new Date('2026-01-01T00:00:00Z')
      await getAuditLog(orgId, {
        entityType: 'Lead',
        userId,
        action: 'UPDATE',
        fromDate,
      })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            entityType: 'Lead',
            userId,
            action: 'UPDATE',
            createdAt: { gte: fromDate },
          },
        }),
      )
    })

    it('applies pagination correctly', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(100)

      const result = await getAuditLog(orgId, {}, { page: 3, pageSize: 20 })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      )
      expect(result.pagination).toEqual({
        page: 3,
        pageSize: 20,
        total: 100,
        totalPages: 5,
      })
    })

    it('caps pageSize at 200', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      await getAuditLog(orgId, {}, { page: 1, pageSize: 10000 })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      )
    })

    it('normalizes page below 1 to 1', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      const result = await getAuditLog(orgId, {}, { page: 0, pageSize: 10 })

      expect(mockDb.auditEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      )
      expect(result.pagination.page).toBe(1)
    })

    it('returns an empty result when no entries match', async () => {
      mockDb.auditEntry.findMany.mockResolvedValue([])
      mockDb.auditEntry.count.mockResolvedValue(0)

      const result = await getAuditLog(orgId)

      expect(result.entries).toEqual([])
      expect(result.pagination.total).toBe(0)
      expect(result.pagination.totalPages).toBe(0)
    })
  })
})
