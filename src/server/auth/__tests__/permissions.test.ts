import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '@/lib/errors'

// Mock the Prisma client
const mockFindMany = vi.fn()

vi.mock('@/server/db/client', () => ({
  prisma: {
    teamMember: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    team: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}))

import { hasPermission, requirePermission, getSubTeamIds, getEffectivePermissions } from '../permissions'
import type { SessionUser } from '../session'

/**
 * Unit tests for RBAC permission checker.
 * Validates: Requirements 3.1, 3.6, 3.7, 3.8, 3.9
 */
describe('RBAC Permission Checker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Helper to create a mock SessionUser with specified team memberships and permissions.
   */
  function createMockUser(memberships: Array<{ teamId: string; roleName: string; permissions: string[] }>): SessionUser {
    return {
      id: 'user-1',
      authId: 'auth-1',
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationMemberships: [
        { id: 'om-1', userId: 'user-1', organizationId: 'org-1', isDefault: true, joinedAt: new Date() },
      ],
      teamMemberships: memberships.map((m, i) => ({
        id: `tm-${i}`,
        userId: 'user-1',
        teamId: m.teamId,
        roleId: `role-${i}`,
        team: {
          id: m.teamId,
          name: `Team ${i}`,
          organizationId: 'org-1',
          parentTeamId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        role: {
          id: `role-${i}`,
          name: m.roleName,
          organizationId: 'org-1',
          isSystem: true,
          hierarchy: m.roleName === 'OWNER' ? 0 : m.roleName === 'ADMIN' ? 1 : m.roleName === 'MANAGER' ? 2 : 3,
          createdAt: new Date(),
          permissions: m.permissions.map((key, j) => ({
            id: `perm-${i}-${j}`,
            roleId: `role-${i}`,
            key,
          })),
        },
      })),
    } as unknown as SessionUser
  }

  describe('hasPermission', () => {
    it('returns true when user has the permission in a single team membership', () => {
      const user = createMockUser([
        { teamId: 'team-1', roleName: 'MEMBER', permissions: ['leads:read', 'leads:write'] },
      ])

      expect(hasPermission(user, 'leads:read')).toBe(true)
      expect(hasPermission(user, 'leads:write')).toBe(true)
    })

    it('returns false when user does not have the permission', () => {
      const user = createMockUser([
        { teamId: 'team-1', roleName: 'MEMBER', permissions: ['leads:read'] },
      ])

      expect(hasPermission(user, 'leads:write')).toBe(false)
      expect(hasPermission(user, 'billing:manage')).toBe(false)
    })

    it('computes union of permissions across multiple team memberships', () => {
      const user = createMockUser([
        { teamId: 'team-1', roleName: 'MEMBER', permissions: ['leads:read'] },
        { teamId: 'team-2', roleName: 'MANAGER', permissions: ['cadences:manage', 'forecast:read'] },
      ])

      // Union of all permissions
      expect(hasPermission(user, 'leads:read')).toBe(true)
      expect(hasPermission(user, 'cadences:manage')).toBe(true)
      expect(hasPermission(user, 'forecast:read')).toBe(true)
      // Not in any membership
      expect(hasPermission(user, 'billing:manage')).toBe(false)
    })

    it('returns false for user with no team memberships', () => {
      const user = createMockUser([])

      expect(hasPermission(user, 'leads:read')).toBe(false)
    })

    it('handles duplicate permissions across teams correctly', () => {
      const user = createMockUser([
        { teamId: 'team-1', roleName: 'MEMBER', permissions: ['leads:read', 'leads:write'] },
        { teamId: 'team-2', roleName: 'MEMBER', permissions: ['leads:read', 'contacts:read'] },
      ])

      expect(hasPermission(user, 'leads:read')).toBe(true)
      expect(hasPermission(user, 'leads:write')).toBe(true)
      expect(hasPermission(user, 'contacts:read')).toBe(true)
    })
  })

  describe('requirePermission', () => {
    it('does not throw when user has the required permission', () => {
      const user = createMockUser([
        { teamId: 'team-1', roleName: 'ADMIN', permissions: ['leads:read', 'leads:write', 'users:manage'] },
      ])

      expect(() => requirePermission(user, 'leads:read')).not.toThrow()
      expect(() => requirePermission(user, 'users:manage')).not.toThrow()
    })

    it('throws AppError with 403 status when permission is missing', () => {
      const user = createMockUser([
        { teamId: 'team-1', roleName: 'MEMBER', permissions: ['leads:read'] },
      ])

      expect(() => requirePermission(user, 'billing:manage')).toThrow(AppError)

      try {
        requirePermission(user, 'billing:manage')
      } catch (error) {
        expect(error).toBeInstanceOf(AppError)
        const appError = error as AppError
        expect(appError.code).toBe('FORBIDDEN')
        expect(appError.message).toBe('Insufficient permissions')
        expect(appError.statusCode).toBe(403)
      }
    })

    it('throws for user with no team memberships', () => {
      const user = createMockUser([])

      expect(() => requirePermission(user, 'leads:read')).toThrow(AppError)
    })
  })

  describe('getSubTeamIds', () => {
    it('returns empty array when team has no children', async () => {
      mockFindMany.mockResolvedValueOnce([])

      const result = await getSubTeamIds('team-root')

      expect(result).toEqual([])
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { parentTeamId: 'team-root' },
        select: { id: true },
      })
    })

    it('returns direct children', async () => {
      mockFindMany
        .mockResolvedValueOnce([{ id: 'child-1' }, { id: 'child-2' }])
        .mockResolvedValueOnce([]) // child-1 has no children
        .mockResolvedValueOnce([]) // child-2 has no children

      const result = await getSubTeamIds('team-root')

      expect(result).toEqual(['child-1', 'child-2'])
    })

    it('recursively resolves nested descendants', async () => {
      mockFindMany
        .mockResolvedValueOnce([{ id: 'child-1' }]) // root's children
        .mockResolvedValueOnce([{ id: 'grandchild-1' }, { id: 'grandchild-2' }]) // child-1's children
        .mockResolvedValueOnce([]) // grandchild-1 has no children
        .mockResolvedValueOnce([{ id: 'great-grandchild-1' }]) // grandchild-2's children
        .mockResolvedValueOnce([]) // great-grandchild-1 has no children

      const result = await getSubTeamIds('team-root')

      expect(result).toEqual(['child-1', 'grandchild-1', 'grandchild-2', 'great-grandchild-1'])
    })
  })

  describe('getEffectivePermissions', () => {
    it('returns all permissions from user team memberships', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          roleId: 'role-1',
          team: { id: 'team-1', name: 'Sales', organizationId: 'org-1', parentTeamId: null },
          role: {
            id: 'role-1',
            name: 'MEMBER',
            hierarchy: 3,
            permissions: [
              { id: 'p1', roleId: 'role-1', key: 'leads:read' },
              { id: 'p2', roleId: 'role-1', key: 'leads:write' },
            ],
          },
        },
      ])

      const result = await getEffectivePermissions('user-1', 'org-1')

      expect(result.has('leads:read')).toBe(true)
      expect(result.has('leads:write')).toBe(true)
      expect(result.has('billing:manage')).toBe(false)
    })

    it('returns union of permissions from multiple team memberships', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          roleId: 'role-1',
          team: { id: 'team-1', name: 'Sales', organizationId: 'org-1', parentTeamId: null },
          role: {
            id: 'role-1',
            name: 'MEMBER',
            hierarchy: 3,
            permissions: [
              { id: 'p1', roleId: 'role-1', key: 'leads:read' },
            ],
          },
        },
        {
          id: 'tm-2',
          userId: 'user-1',
          teamId: 'team-2',
          roleId: 'role-2',
          team: { id: 'team-2', name: 'Marketing', organizationId: 'org-1', parentTeamId: null },
          role: {
            id: 'role-2',
            name: 'MANAGER',
            hierarchy: 2,
            permissions: [
              { id: 'p3', roleId: 'role-2', key: 'cadences:manage' },
              { id: 'p4', roleId: 'role-2', key: 'forecast:read' },
            ],
          },
        },
      ])
      // getSubTeamIds call for MANAGER role (hierarchy <= 2)
      mockFindMany.mockResolvedValueOnce([]) // team-2 has no children

      const result = await getEffectivePermissions('user-1', 'org-1')

      expect(result.has('leads:read')).toBe(true)
      expect(result.has('cadences:manage')).toBe(true)
      expect(result.has('forecast:read')).toBe(true)
    })
  })
})
