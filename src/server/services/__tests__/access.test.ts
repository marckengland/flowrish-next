import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma client
const mockTeamMemberFindMany = vi.fn()

vi.mock('@/server/db/client', () => ({
  prisma: {
    teamMember: {
      findMany: (...args: any[]) => mockTeamMemberFindMany(...args),
    },
  },
}))

// Mock getAccessibleTeamIds from teams service
const mockGetAccessibleTeamIds = vi.fn()
vi.mock('@/server/services/teams', () => ({
  getAccessibleTeamIds: (...args: any[]) => mockGetAccessibleTeamIds(...args),
}))

import { getLeadAccessFilter } from '../access'
import type { SessionUser } from '@/server/auth/session'

/**
 * Helper to create a mock SessionUser with the given role hierarchy.
 */
function createMockUser(
  userId: string,
  memberships: Array<{
    teamId: string
    orgId: string
    hierarchy: number
    roleName: string
  }>,
): SessionUser {
  return {
    id: userId,
    authId: `auth-${userId}`,
    email: `${userId}@example.com`,
    name: 'Test User',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organizationMemberships: memberships.map((m) => ({
      id: `om-${m.orgId}`,
      userId,
      organizationId: m.orgId,
      isDefault: true,
      joinedAt: new Date(),
    })),
    teamMemberships: memberships.map((m) => ({
      id: `tm-${m.teamId}`,
      userId,
      teamId: m.teamId,
      roleId: `role-${m.roleName.toLowerCase()}`,
      team: {
        id: m.teamId,
        name: `Team ${m.teamId}`,
        organizationId: m.orgId,
        parentTeamId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      role: {
        id: `role-${m.roleName.toLowerCase()}`,
        name: m.roleName,
        organizationId: m.orgId,
        isSystem: true,
        hierarchy: m.hierarchy,
        createdAt: new Date(),
        permissions: [],
      },
    })),
  } as unknown as SessionUser
}

describe('Lead Access Scoping Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getLeadAccessFilter', () => {
    it('returns only deletedAt filter for OWNER (hierarchy 0)', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 0, roleName: 'OWNER' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      expect(filter).toEqual({ deletedAt: null })
      expect(filter.assignedUserId).toBeUndefined()
      expect(mockGetAccessibleTeamIds).not.toHaveBeenCalled()
      expect(mockTeamMemberFindMany).not.toHaveBeenCalled()
    })

    it('returns only deletedAt filter for ADMIN (hierarchy 1)', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 1, roleName: 'ADMIN' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      expect(filter).toEqual({ deletedAt: null })
      expect(filter.assignedUserId).toBeUndefined()
      expect(mockGetAccessibleTeamIds).not.toHaveBeenCalled()
    })

    it('returns assignedUserId filter with team user IDs for MANAGER (hierarchy 2)', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 2, roleName: 'MANAGER' },
      ])

      mockGetAccessibleTeamIds.mockResolvedValueOnce(['team-1', 'team-child-1'])
      mockTeamMemberFindMany.mockResolvedValueOnce([
        { userId: 'user-1' },
        { userId: 'user-2' },
        { userId: 'user-3' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      expect(filter.deletedAt).toBeNull()
      expect(filter.assignedUserId).toEqual({ in: ['user-1', 'user-2', 'user-3'] })
      expect(mockGetAccessibleTeamIds).toHaveBeenCalledWith('user-1', 'org-1')
      expect(mockTeamMemberFindMany).toHaveBeenCalledWith({
        where: { teamId: { in: ['team-1', 'team-child-1'] } },
        select: { userId: true },
      })
    })

    it('returns own userId filter for MEMBER (hierarchy 3)', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 3, roleName: 'MEMBER' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      expect(filter.deletedAt).toBeNull()
      expect(filter.assignedUserId).toBe('user-1')
      expect(mockGetAccessibleTeamIds).not.toHaveBeenCalled()
      expect(mockTeamMemberFindMany).not.toHaveBeenCalled()
    })

    it('uses highest privilege when user has mixed roles (ADMIN + MEMBER)', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 1, roleName: 'ADMIN' },
        { teamId: 'team-2', orgId: 'org-1', hierarchy: 3, roleName: 'MEMBER' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      // ADMIN privilege wins — all org leads
      expect(filter).toEqual({ deletedAt: null })
      expect(filter.assignedUserId).toBeUndefined()
    })

    it('uses highest privilege when user has mixed roles (MANAGER + MEMBER)', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 2, roleName: 'MANAGER' },
        { teamId: 'team-2', orgId: 'org-1', hierarchy: 3, roleName: 'MEMBER' },
      ])

      mockGetAccessibleTeamIds.mockResolvedValueOnce(['team-1', 'team-2', 'team-child-1'])
      mockTeamMemberFindMany.mockResolvedValueOnce([
        { userId: 'user-1' },
        { userId: 'user-2' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      // MANAGER privilege wins — team-scoped access
      expect(filter.deletedAt).toBeNull()
      expect(filter.assignedUserId).toEqual({ in: ['user-1', 'user-2'] })
    })

    it('deduplicates user IDs when same user appears in multiple teams', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 2, roleName: 'MANAGER' },
      ])

      mockGetAccessibleTeamIds.mockResolvedValueOnce(['team-1', 'team-2'])
      mockTeamMemberFindMany.mockResolvedValueOnce([
        { userId: 'user-2' },
        { userId: 'user-3' },
        { userId: 'user-2' }, // duplicate
        { userId: 'user-3' }, // duplicate
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      expect(filter.deletedAt).toBeNull()
      const userIds = (filter.assignedUserId as { in: string[] }).in
      expect(userIds).toHaveLength(2)
      expect(userIds).toContain('user-2')
      expect(userIds).toContain('user-3')
    })

    it('always includes deletedAt: null regardless of role', async () => {
      // Test OWNER
      const owner = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 0, roleName: 'OWNER' },
      ])
      expect((await getLeadAccessFilter(owner, 'org-1')).deletedAt).toBeNull()

      // Test ADMIN
      const admin = createMockUser('user-2', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 1, roleName: 'ADMIN' },
      ])
      expect((await getLeadAccessFilter(admin, 'org-1')).deletedAt).toBeNull()

      // Test MANAGER
      const manager = createMockUser('user-3', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 2, roleName: 'MANAGER' },
      ])
      mockGetAccessibleTeamIds.mockResolvedValueOnce(['team-1'])
      mockTeamMemberFindMany.mockResolvedValueOnce([{ userId: 'user-3' }])
      expect((await getLeadAccessFilter(manager, 'org-1')).deletedAt).toBeNull()

      // Test MEMBER
      const member = createMockUser('user-4', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 3, roleName: 'MEMBER' },
      ])
      expect((await getLeadAccessFilter(member, 'org-1')).deletedAt).toBeNull()
    })

    it('handles user with no team memberships (returns own userId filter)', async () => {
      const user = {
        id: 'user-1',
        authId: 'auth-user-1',
        email: 'user@example.com',
        name: 'Test User',
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationMemberships: [],
        teamMemberships: [],
      } as unknown as SessionUser

      const filter = await getLeadAccessFilter(user, 'org-1')

      // No memberships means lowest privilege — own leads only
      expect(filter.deletedAt).toBeNull()
      expect(filter.assignedUserId).toBe('user-1')
    })

    it('handles custom role with hierarchy > 3 as MEMBER-level access', async () => {
      const user = createMockUser('user-1', [
        { teamId: 'team-1', orgId: 'org-1', hierarchy: 5, roleName: 'CUSTOM_LOW' },
      ])

      const filter = await getLeadAccessFilter(user, 'org-1')

      expect(filter.deletedAt).toBeNull()
      expect(filter.assignedUserId).toBe('user-1')
    })
  })
})
