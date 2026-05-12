import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '@/lib/errors'

// Mock Prisma client
const mockOrgFindUnique = vi.fn()
const mockTeamFindUnique = vi.fn()
const mockTeamFindMany = vi.fn()
const mockTeamCreate = vi.fn()
const mockUserFindUnique = vi.fn()
const mockRoleFindUnique = vi.fn()
const mockTeamMemberFindUnique = vi.fn()
const mockTeamMemberFindMany = vi.fn()
const mockTeamMemberCreate = vi.fn()

vi.mock('@/server/db/client', () => ({
  prisma: {
    organization: {
      findUnique: (...args: any[]) => mockOrgFindUnique(...args),
    },
    team: {
      findUnique: (...args: any[]) => mockTeamFindUnique(...args),
      findMany: (...args: any[]) => mockTeamFindMany(...args),
      create: (...args: any[]) => mockTeamCreate(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockUserFindUnique(...args),
    },
    role: {
      findUnique: (...args: any[]) => mockRoleFindUnique(...args),
    },
    teamMember: {
      findUnique: (...args: any[]) => mockTeamMemberFindUnique(...args),
      findMany: (...args: any[]) => mockTeamMemberFindMany(...args),
      create: (...args: any[]) => mockTeamMemberCreate(...args),
    },
  },
}))

// Mock getSubTeamIds from permissions
const mockGetSubTeamIds = vi.fn()
vi.mock('@/server/auth/permissions', () => ({
  getSubTeamIds: (...args: any[]) => mockGetSubTeamIds(...args),
}))

import { createTeam, addTeamMember, getTeamHierarchy, getAccessibleTeamIds } from '../teams'

describe('Team Hierarchy Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createTeam', () => {
    it('creates a team without a parent', async () => {
      mockOrgFindUnique.mockResolvedValueOnce({ id: 'org-1' })
      mockTeamCreate.mockResolvedValueOnce({
        id: 'team-1',
        name: 'Sales',
        organizationId: 'org-1',
        parentTeamId: null,
        members: [],
        childTeams: [],
      })

      const result = await createTeam('Sales', 'org-1')

      expect(result.name).toBe('Sales')
      expect(result.parentTeamId).toBeNull()
      expect(mockTeamCreate).toHaveBeenCalledWith({
        data: {
          name: 'Sales',
          organizationId: 'org-1',
          parentTeamId: null,
        },
        include: {
          members: true,
          childTeams: true,
        },
      })
    })

    it('creates a team with a parent', async () => {
      mockOrgFindUnique.mockResolvedValueOnce({ id: 'org-1' })
      mockTeamFindUnique.mockResolvedValueOnce({ id: 'parent-1', organizationId: 'org-1' })
      mockTeamCreate.mockResolvedValueOnce({
        id: 'team-2',
        name: 'Sales West',
        organizationId: 'org-1',
        parentTeamId: 'parent-1',
        members: [],
        childTeams: [],
      })

      const result = await createTeam('Sales West', 'org-1', 'parent-1')

      expect(result.parentTeamId).toBe('parent-1')
      expect(mockTeamCreate).toHaveBeenCalledWith({
        data: {
          name: 'Sales West',
          organizationId: 'org-1',
          parentTeamId: 'parent-1',
        },
        include: {
          members: true,
          childTeams: true,
        },
      })
    })

    it('throws NOT_FOUND when organization does not exist', async () => {
      mockOrgFindUnique.mockResolvedValue(null)

      const error = await createTeam('Sales', 'nonexistent-org').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.statusCode).toBe(404)
    })

    it('throws NOT_FOUND when parent team does not exist', async () => {
      mockOrgFindUnique.mockResolvedValue({ id: 'org-1' })
      mockTeamFindUnique.mockResolvedValue(null)

      const error = await createTeam('Sales', 'org-1', 'nonexistent-parent').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.statusCode).toBe(404)
    })

    it('throws VALIDATION_ERROR when parent team belongs to a different org', async () => {
      mockOrgFindUnique.mockResolvedValue({ id: 'org-1' })
      mockTeamFindUnique.mockResolvedValue({ id: 'parent-1', organizationId: 'org-2' })

      const error = await createTeam('Sales', 'org-1', 'parent-1').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.statusCode).toBe(400)
    })
  })

  describe('addTeamMember', () => {
    it('adds a user to a team with a role', async () => {
      mockTeamFindUnique.mockResolvedValueOnce({ id: 'team-1', organizationId: 'org-1' })
      mockUserFindUnique.mockResolvedValueOnce({ id: 'user-1' })
      mockRoleFindUnique.mockResolvedValueOnce({ id: 'role-1' })
      mockTeamMemberFindUnique.mockResolvedValueOnce(null)
      mockTeamMemberCreate.mockResolvedValueOnce({
        id: 'tm-1',
        userId: 'user-1',
        teamId: 'team-1',
        roleId: 'role-1',
        user: { id: 'user-1', name: 'John', email: 'john@example.com' },
        role: { id: 'role-1', name: 'MEMBER', hierarchy: 3 },
        team: { id: 'team-1', name: 'Sales' },
      })

      const result = await addTeamMember('user-1', 'team-1', 'role-1')

      expect(result.userId).toBe('user-1')
      expect(result.teamId).toBe('team-1')
      expect(result.roleId).toBe('role-1')
    })

    it('throws NOT_FOUND when team does not exist', async () => {
      mockTeamFindUnique.mockResolvedValue(null)

      const error = await addTeamMember('user-1', 'nonexistent', 'role-1').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe('Team not found')
      expect(error.statusCode).toBe(404)
    })

    it('throws NOT_FOUND when user does not exist', async () => {
      mockTeamFindUnique.mockResolvedValue({ id: 'team-1', organizationId: 'org-1' })
      mockUserFindUnique.mockResolvedValue(null)

      const error = await addTeamMember('nonexistent', 'team-1', 'role-1').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe('User not found')
      expect(error.statusCode).toBe(404)
    })

    it('throws NOT_FOUND when role does not exist', async () => {
      mockTeamFindUnique.mockResolvedValue({ id: 'team-1', organizationId: 'org-1' })
      mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
      mockRoleFindUnique.mockResolvedValue(null)

      const error = await addTeamMember('user-1', 'team-1', 'nonexistent').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.message).toBe('Role not found')
      expect(error.statusCode).toBe(404)
    })

    it('throws CONFLICT when user is already a member of the team', async () => {
      mockTeamFindUnique.mockResolvedValue({ id: 'team-1', organizationId: 'org-1' })
      mockUserFindUnique.mockResolvedValue({ id: 'user-1' })
      mockRoleFindUnique.mockResolvedValue({ id: 'role-1' })
      mockTeamMemberFindUnique.mockResolvedValue({ id: 'existing-tm', userId: 'user-1', teamId: 'team-1' })

      const error = await addTeamMember('user-1', 'team-1', 'role-1').catch((e) => e)

      expect(error).toBeInstanceOf(AppError)
      expect(error.code).toBe('CONFLICT')
      expect(error.statusCode).toBe(409)
    })
  })

  describe('getTeamHierarchy', () => {
    it('returns empty array when org has no teams', async () => {
      mockTeamFindMany.mockResolvedValueOnce([])

      const result = await getTeamHierarchy('org-1')

      expect(result).toEqual([])
    })

    it('returns flat list of root teams when no hierarchy exists', async () => {
      mockTeamFindMany.mockResolvedValueOnce([
        {
          id: 'team-1',
          name: 'Sales',
          organizationId: 'org-1',
          parentTeamId: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          members: [{ id: 'tm-1', userId: 'user-1', roleId: 'role-1' }],
        },
        {
          id: 'team-2',
          name: 'Marketing',
          organizationId: 'org-1',
          parentTeamId: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          members: [],
        },
      ])

      const result = await getTeamHierarchy('org-1')

      expect(result).toHaveLength(2)
      expect(result[0].children).toEqual([])
      expect(result[1].children).toEqual([])
    })

    it('builds nested tree structure with parent-child relationships', async () => {
      mockTeamFindMany.mockResolvedValueOnce([
        {
          id: 'team-root',
          name: 'Sales',
          organizationId: 'org-1',
          parentTeamId: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          members: [],
        },
        {
          id: 'team-child-1',
          name: 'Sales West',
          organizationId: 'org-1',
          parentTeamId: 'team-root',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          members: [],
        },
        {
          id: 'team-child-2',
          name: 'Sales East',
          organizationId: 'org-1',
          parentTeamId: 'team-root',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          members: [],
        },
        {
          id: 'team-grandchild',
          name: 'Sales West - LA',
          organizationId: 'org-1',
          parentTeamId: 'team-child-1',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          members: [],
        },
      ])

      const result = await getTeamHierarchy('org-1')

      // Only root team at top level
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('team-root')
      expect(result[0].children).toHaveLength(2)

      // Children of root
      const westTeam = result[0].children.find((c) => c.id === 'team-child-1')
      expect(westTeam).toBeDefined()
      expect(westTeam!.children).toHaveLength(1)
      expect(westTeam!.children[0].id).toBe('team-grandchild')

      const eastTeam = result[0].children.find((c) => c.id === 'team-child-2')
      expect(eastTeam).toBeDefined()
      expect(eastTeam!.children).toHaveLength(0)
    })
  })

  describe('getAccessibleTeamIds', () => {
    it('returns empty array when user has no memberships in the org', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([])

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      expect(result).toEqual([])
    })

    it('returns all org teams for OWNER (hierarchy 0)', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          roleId: 'role-owner',
          role: { hierarchy: 0 },
          team: { id: 'team-1' },
        },
      ])
      mockTeamFindMany.mockResolvedValueOnce([
        { id: 'team-1' },
        { id: 'team-2' },
        { id: 'team-3' },
      ])

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      expect(result).toHaveLength(3)
      expect(result).toContain('team-1')
      expect(result).toContain('team-2')
      expect(result).toContain('team-3')
    })

    it('returns all org teams for ADMIN (hierarchy 1)', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          roleId: 'role-admin',
          role: { hierarchy: 1 },
          team: { id: 'team-1' },
        },
      ])
      mockTeamFindMany.mockResolvedValueOnce([
        { id: 'team-1' },
        { id: 'team-2' },
      ])

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      expect(result).toHaveLength(2)
      expect(result).toContain('team-1')
      expect(result).toContain('team-2')
    })

    it('returns direct teams + sub-teams for MANAGER (hierarchy 2)', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-parent',
          roleId: 'role-manager',
          role: { hierarchy: 2 },
          team: { id: 'team-parent' },
        },
      ])
      mockGetSubTeamIds.mockResolvedValueOnce(['team-child-1', 'team-child-2'])

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      expect(result).toHaveLength(3)
      expect(result).toContain('team-parent')
      expect(result).toContain('team-child-1')
      expect(result).toContain('team-child-2')
    })

    it('returns only direct teams for MEMBER (hierarchy 3)', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          roleId: 'role-member',
          role: { hierarchy: 3 },
          team: { id: 'team-1' },
        },
        {
          id: 'tm-2',
          userId: 'user-1',
          teamId: 'team-2',
          roleId: 'role-member',
          role: { hierarchy: 3 },
          team: { id: 'team-2' },
        },
      ])

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      expect(result).toHaveLength(2)
      expect(result).toContain('team-1')
      expect(result).toContain('team-2')
      // getSubTeamIds should NOT be called for MEMBER
      expect(mockGetSubTeamIds).not.toHaveBeenCalled()
    })

    it('handles mixed roles - uses highest privilege (ADMIN in one team, MEMBER in another)', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          roleId: 'role-admin',
          role: { hierarchy: 1 },
          team: { id: 'team-1' },
        },
        {
          id: 'tm-2',
          userId: 'user-1',
          teamId: 'team-2',
          roleId: 'role-member',
          role: { hierarchy: 3 },
          team: { id: 'team-2' },
        },
      ])
      // ADMIN privilege means all teams
      mockTeamFindMany.mockResolvedValueOnce([
        { id: 'team-1' },
        { id: 'team-2' },
        { id: 'team-3' },
      ])

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      expect(result).toHaveLength(3)
    })

    it('deduplicates team IDs when MANAGER has overlapping sub-teams', async () => {
      mockTeamMemberFindMany.mockResolvedValueOnce([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-parent-1',
          roleId: 'role-manager',
          role: { hierarchy: 2 },
          team: { id: 'team-parent-1' },
        },
        {
          id: 'tm-2',
          userId: 'user-1',
          teamId: 'team-child-shared',
          roleId: 'role-manager',
          role: { hierarchy: 2 },
          team: { id: 'team-child-shared' },
        },
      ])
      // team-parent-1's sub-teams include team-child-shared
      mockGetSubTeamIds
        .mockResolvedValueOnce(['team-child-shared', 'team-grandchild'])
        .mockResolvedValueOnce([]) // team-child-shared has no sub-teams

      const result = await getAccessibleTeamIds('user-1', 'org-1')

      // Should be deduplicated: team-parent-1, team-child-shared, team-grandchild
      expect(result).toHaveLength(3)
      expect(result).toContain('team-parent-1')
      expect(result).toContain('team-child-shared')
      expect(result).toContain('team-grandchild')
    })
  })
})
