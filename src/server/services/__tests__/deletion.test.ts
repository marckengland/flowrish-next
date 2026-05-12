import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/session'

/**
 * Unit tests for the deletion request workflow service.
 *
 * Tests cover:
 * - requestDeletion: creates pending request, rejects duplicates, validates input
 * - listPendingRequests / listDeletionRequests: filtering by status/entity/requester
 * - approveRequest: soft-deletes leads, hard-deletes contacts/tasks, marks approved
 * - rejectRequest: marks rejected without executing deletion
 * - canDirectDelete: role-hierarchy gate for MANAGER+
 *
 * **Validates: Requirements 33.1, 33.2, 33.3, 33.4, 33.5, 33.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  deletionRequest: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  contact: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['DeletionRequest', 'Lead', 'Contact', 'Task'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {},
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import {
  requestDeletion,
  listPendingRequests,
  listDeletionRequests,
  approveRequest,
  rejectRequest,
  canDirectDelete,
} from '@/server/services/deletion'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createMockUser(hierarchy: number): SessionUser {
  return {
    id: 'user-1',
    authId: 'auth-1',
    email: 'user@example.com',
    name: 'Test User',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organizationMemberships: [],
    teamMemberships: [
      {
        id: 'tm-1',
        userId: 'user-1',
        teamId: 'team-1',
        roleId: 'role-1',
        team: {
          id: 'team-1',
          name: 'Team',
          organizationId: 'org-1',
          parentTeamId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        role: {
          id: 'role-1',
          name: 'TEST',
          organizationId: 'org-1',
          isSystem: true,
          hierarchy,
          createdAt: new Date(),
          permissions: [],
        },
      },
    ],
  } as unknown as SessionUser
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Deletion Request Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'
  const reviewerId = '770e8400-e29b-41d4-a716-446655440002'
  const requestId = '880e8400-e29b-41d4-a716-446655440003'
  const entityId = '990e8400-e29b-41d4-a716-446655440004'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── canDirectDelete ───────────────────────────────────────────────────────

  describe('canDirectDelete', () => {
    it('returns true for OWNER (hierarchy 0)', () => {
      expect(canDirectDelete(createMockUser(0))).toBe(true)
    })

    it('returns true for ADMIN (hierarchy 1)', () => {
      expect(canDirectDelete(createMockUser(1))).toBe(true)
    })

    it('returns true for MANAGER (hierarchy 2)', () => {
      expect(canDirectDelete(createMockUser(2))).toBe(true)
    })

    it('returns false for MEMBER (hierarchy 3)', () => {
      expect(canDirectDelete(createMockUser(3))).toBe(false)
    })

    it('returns false for custom low-privilege role (hierarchy 5)', () => {
      expect(canDirectDelete(createMockUser(5))).toBe(false)
    })

    it('returns false for user with no memberships', () => {
      const user = createMockUser(0)
      ;(user as any).teamMemberships = []
      expect(canDirectDelete(user)).toBe(false)
    })
  })

  // ─── requestDeletion ───────────────────────────────────────────────────────

  describe('requestDeletion', () => {
    const validInput = {
      entityType: 'Lead' as const,
      entityId,
      entityName: 'Acme Co',
      reason: 'Duplicate record',
    }

    it('throws VALIDATION_ERROR when userId is empty', async () => {
      await expect(requestDeletion('', orgId, validInput)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws VALIDATION_ERROR when orgId is empty', async () => {
      await expect(requestDeletion(userId, '', validInput)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('rejects invalid entity type via Zod', async () => {
      await expect(
        requestDeletion(userId, orgId, { ...validInput, entityType: 'Company' }),
      ).rejects.toThrow()
    })

    it('rejects invalid entity ID via Zod', async () => {
      await expect(
        requestDeletion(userId, orgId, { ...validInput, entityId: 'not-a-uuid' }),
      ).rejects.toThrow()
    })

    it('throws DUPLICATE_REQUEST when a pending request already exists', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: 'existing',
        status: 'pending',
      })

      await expect(requestDeletion(userId, orgId, validInput)).rejects.toMatchObject({
        code: 'DUPLICATE_REQUEST',
        statusCode: 409,
      })
    })

    it('creates a pending request with the provided fields', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null)
      const created = { id: 'req-1', status: 'pending' }
      mockDb.deletionRequest.create.mockResolvedValueOnce(created)

      const result = await requestDeletion(userId, orgId, validInput)

      expect(result).toEqual(created)
      expect(mockDb.deletionRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'Lead',
          entityId,
          entityName: 'Acme Co',
          reason: 'Duplicate record',
          requestedById: userId,
          status: 'pending',
        }),
      })
    })

    it('stores reason as null when omitted', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null)
      mockDb.deletionRequest.create.mockResolvedValueOnce({ id: 'req-1' })

      await requestDeletion(userId, orgId, {
        entityType: 'Task',
        entityId,
        entityName: 'Follow up',
      })

      expect(mockDb.deletionRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ reason: null }),
      })
    })
  })

  // ─── listPendingRequests ───────────────────────────────────────────────────

  describe('listPendingRequests', () => {
    it('throws VALIDATION_ERROR when orgId is empty', async () => {
      await expect(listPendingRequests('')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('returns pending requests ordered by createdAt ascending', async () => {
      const pending = [{ id: 'req-1' }, { id: 'req-2' }]
      mockDb.deletionRequest.findMany.mockResolvedValueOnce(pending)

      const result = await listPendingRequests(orgId)

      expect(result).toEqual(pending)
      expect(mockDb.deletionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
        }),
      )
    })
  })

  // ─── listDeletionRequests ──────────────────────────────────────────────────

  describe('listDeletionRequests', () => {
    it('throws VALIDATION_ERROR when orgId is empty', async () => {
      await expect(listDeletionRequests('')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('lists all requests with no filters applied', async () => {
      mockDb.deletionRequest.findMany.mockResolvedValueOnce([])

      await listDeletionRequests(orgId)

      expect(mockDb.deletionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: 'desc' },
        }),
      )
    })

    it('applies status, entityType, and requestedById filters', async () => {
      mockDb.deletionRequest.findMany.mockResolvedValueOnce([])

      await listDeletionRequests(orgId, {
        status: 'approved',
        entityType: 'Contact',
        requestedById: userId,
      })

      expect(mockDb.deletionRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'approved',
            entityType: 'Contact',
            requestedById: userId,
          },
        }),
      )
    })
  })

  // ─── approveRequest ────────────────────────────────────────────────────────

  describe('approveRequest', () => {
    it('throws NOT_FOUND when the request does not exist', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null)

      await expect(
        approveRequest(requestId, reviewerId, orgId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
    })

    it('throws INVALID_STATE when the request is already approved', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      await expect(
        approveRequest(requestId, reviewerId, orgId),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', statusCode: 400 })
    })

    it('throws INVALID_STATE when the request is already rejected', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'rejected',
      })

      await expect(
        approveRequest(requestId, reviewerId, orgId),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', statusCode: 400 })
    })

    it('soft-deletes a Lead (sets deletedAt) and marks request approved', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'pending',
        entityType: 'Lead',
        entityId,
      })
      mockDb.lead.findFirst.mockResolvedValueOnce({ id: entityId, deletedAt: null })
      mockDb.lead.update.mockResolvedValueOnce({ id: entityId, deletedAt: new Date() })
      mockDb.deletionRequest.update.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      const result = await approveRequest(requestId, reviewerId, orgId)

      expect(mockDb.lead.update).toHaveBeenCalledWith({
        where: { id: entityId },
        data: { deletedAt: expect.any(Date) },
      })
      expect(mockDb.contact.delete).not.toHaveBeenCalled()
      expect(mockDb.task.delete).not.toHaveBeenCalled()
      expect(mockDb.deletionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: requestId },
          data: expect.objectContaining({
            status: 'approved',
            reviewedById: reviewerId,
          }),
        }),
      )
      expect(result.status).toBe('approved')
    })

    it('skips soft-delete when Lead is already soft-deleted (idempotent)', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'pending',
        entityType: 'Lead',
        entityId,
      })
      mockDb.lead.findFirst.mockResolvedValueOnce({
        id: entityId,
        deletedAt: new Date(),
      })
      mockDb.deletionRequest.update.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      await approveRequest(requestId, reviewerId, orgId)

      expect(mockDb.lead.update).not.toHaveBeenCalled()
    })

    it('hard-deletes a Contact and marks request approved', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'pending',
        entityType: 'Contact',
        entityId,
      })
      mockDb.contact.findFirst.mockResolvedValueOnce({ id: entityId })
      mockDb.contact.delete.mockResolvedValueOnce({ id: entityId })
      mockDb.deletionRequest.update.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      await approveRequest(requestId, reviewerId, orgId)

      expect(mockDb.contact.delete).toHaveBeenCalledWith({
        where: { id: entityId },
      })
      expect(mockDb.lead.update).not.toHaveBeenCalled()
    })

    it('hard-deletes a Task and marks request approved', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'pending',
        entityType: 'Task',
        entityId,
      })
      mockDb.task.findFirst.mockResolvedValueOnce({ id: entityId })
      mockDb.task.delete.mockResolvedValueOnce({ id: entityId })
      mockDb.deletionRequest.update.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      await approveRequest(requestId, reviewerId, orgId)

      expect(mockDb.task.delete).toHaveBeenCalledWith({
        where: { id: entityId },
      })
    })

    it('marks approved even when the target entity no longer exists', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'pending',
        entityType: 'Task',
        entityId,
      })
      mockDb.task.findFirst.mockResolvedValueOnce(null)
      mockDb.deletionRequest.update.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      await approveRequest(requestId, reviewerId, orgId)

      expect(mockDb.task.delete).not.toHaveBeenCalled()
      expect(mockDb.deletionRequest.update).toHaveBeenCalled()
    })
  })

  // ─── rejectRequest ─────────────────────────────────────────────────────────

  describe('rejectRequest', () => {
    it('throws NOT_FOUND when the request does not exist', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce(null)

      await expect(
        rejectRequest(requestId, reviewerId, orgId),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 })
    })

    it('throws INVALID_STATE when the request is not pending', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'approved',
      })

      await expect(
        rejectRequest(requestId, reviewerId, orgId),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', statusCode: 400 })
    })

    it('marks the request rejected without performing any deletion', async () => {
      mockDb.deletionRequest.findFirst.mockResolvedValueOnce({
        id: requestId,
        status: 'pending',
        entityType: 'Lead',
        entityId,
      })
      mockDb.deletionRequest.update.mockResolvedValueOnce({
        id: requestId,
        status: 'rejected',
      })

      const result = await rejectRequest(requestId, reviewerId, orgId)

      expect(mockDb.lead.update).not.toHaveBeenCalled()
      expect(mockDb.contact.delete).not.toHaveBeenCalled()
      expect(mockDb.task.delete).not.toHaveBeenCalled()
      expect(mockDb.deletionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: requestId },
          data: expect.objectContaining({
            status: 'rejected',
            reviewedById: reviewerId,
          }),
        }),
      )
      expect(result.status).toBe('rejected')
    })
  })
})
