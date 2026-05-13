import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '@/lib/errors'

// Mock Prisma client
const mockFindUnique = vi.fn()
const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockTransaction = vi.fn()
const mockTeamMemberFindMany = vi.fn()

vi.mock('@/server/db/client', () => ({
  prisma: {
    organization: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
    organizationMember: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    organizationInvite: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
    team: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
    },
    role: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
    teamMember: {
      findMany: (...args: any[]) => mockTeamMemberFindMany(...args),
    },
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
}))

import {
  createOrganization,
  inviteToOrganization,
  acceptInvite,
} from '../organizations'

describe('Organization Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createOrganization', () => {
    it('throws VALIDATION_ERROR when name is empty', async () => {
      await expect(createOrganization('', 'slug', 'owner-1')).rejects.toThrow(AppError)
      await expect(createOrganization('  ', 'slug', 'owner-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws VALIDATION_ERROR when slug is empty', async () => {
      await expect(createOrganization('Acme', '', 'owner-1')).rejects.toThrow(AppError)
      await expect(createOrganization('Acme', '  ', 'owner-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws VALIDATION_ERROR when ownerId is empty', async () => {
      await expect(createOrganization('Acme', 'acme', '')).rejects.toThrow(AppError)
      await expect(createOrganization('Acme', 'acme', '  ')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws CONFLICT when slug already exists', async () => {
      // First findUnique call is for organization slug check
      mockFindUnique.mockResolvedValueOnce({ id: 'existing-org', slug: 'acme' })

      await expect(createOrganization('Acme', 'acme', 'owner-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
      })
    })

    it('throws NOT_FOUND when owner user does not exist', async () => {
      // First findUnique: org slug check → null
      mockFindUnique.mockResolvedValueOnce(null)
      // Second findUnique: user check → null
      mockFindUnique.mockResolvedValueOnce(null)

      await expect(createOrganization('Acme', 'acme', 'owner-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('creates org, default team, roles, and memberships in a transaction', async () => {
      const mockOrg = { id: 'org-1', name: 'Acme', slug: 'acme' }
      const mockTeam = { id: 'team-1', name: 'General', organizationId: 'org-1' }
      const mockRoles = [
        { id: 'role-owner', name: 'OWNER', hierarchy: 0, permissions: [] },
        { id: 'role-admin', name: 'ADMIN', hierarchy: 1, permissions: [] },
        { id: 'role-manager', name: 'MANAGER', hierarchy: 2, permissions: [] },
        { id: 'role-member', name: 'MEMBER', hierarchy: 3, permissions: [] },
      ]

      // org slug check → null (no conflict)
      mockFindUnique.mockResolvedValueOnce(null)
      // user check → exists
      mockFindUnique.mockResolvedValueOnce({ id: 'owner-1', email: 'owner@acme.com' })

      // Transaction callback
      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          organization: { create: vi.fn().mockResolvedValue(mockOrg) },
          team: { create: vi.fn().mockResolvedValue(mockTeam) },
          role: { create: vi.fn() },
          organizationMember: { create: vi.fn().mockResolvedValue({}) },
          teamMember: { create: vi.fn().mockResolvedValue({}) },
        }
        // Mock role creation for each of the 4 roles
        tx.role.create
          .mockResolvedValueOnce(mockRoles[0])
          .mockResolvedValueOnce(mockRoles[1])
          .mockResolvedValueOnce(mockRoles[2])
          .mockResolvedValueOnce(mockRoles[3])

        return callback(tx)
      })

      const result = await createOrganization('Acme', 'acme', 'owner-1')

      expect(result.organization).toEqual(mockOrg)
      expect(result.defaultTeam).toEqual(mockTeam)
      expect(result.roles).toHaveLength(4)
      expect(result.roles.map((r: any) => r.name)).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'])
    })
  })

  describe('inviteToOrganization', () => {
    it('throws VALIDATION_ERROR when email is empty', async () => {
      await expect(
        inviteToOrganization('', 'org-1', 'role-1', 'user-1'),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws NOT_FOUND when organization does not exist', async () => {
      // org findUnique → null
      mockFindUnique.mockResolvedValueOnce(null)

      await expect(
        inviteToOrganization('invite@test.com', 'org-1', 'role-1', 'user-1'),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws NOT_FOUND when role does not exist', async () => {
      // org findUnique → exists
      mockFindUnique.mockResolvedValueOnce({ id: 'org-1' })
      // role findUnique → null
      mockFindUnique.mockResolvedValueOnce(null)

      await expect(
        inviteToOrganization('invite@test.com', 'org-1', 'role-1', 'user-1'),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws FORBIDDEN when role belongs to a different organization', async () => {
      // org findUnique → exists
      mockFindUnique.mockResolvedValueOnce({ id: 'org-1' })
      // role findUnique → exists but belongs to different org
      mockFindUnique.mockResolvedValueOnce({ id: 'role-1', organizationId: 'org-other' })

      await expect(
        inviteToOrganization('invite@test.com', 'org-1', 'role-1', 'user-1'),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      })
    })

    it('throws CONFLICT when a pending invite already exists', async () => {
      // org findUnique → exists
      mockFindUnique.mockResolvedValueOnce({ id: 'org-1' })
      // role findUnique → exists (system role, orgId null, hierarchy 3)
      mockFindUnique.mockResolvedValueOnce({ id: 'role-1', organizationId: null, hierarchy: 3 })
      // privilege escalation check: inviter has hierarchy 1 (ADMIN)
      mockTeamMemberFindMany.mockResolvedValueOnce([
        { id: 'tm-1', role: { hierarchy: 1 } },
      ])
      // existing pending invite
      mockFindFirst.mockResolvedValueOnce({ id: 'invite-existing', status: 'pending' })

      await expect(
        inviteToOrganization('invite@test.com', 'org-1', 'role-1', 'user-1'),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
      })
    })

    it('creates invite with 7-day expiration', async () => {
      // org findUnique → exists
      mockFindUnique.mockResolvedValueOnce({ id: 'org-1' })
      // role findUnique → exists (belongs to org, hierarchy 3)
      mockFindUnique.mockResolvedValueOnce({ id: 'role-1', organizationId: 'org-1', hierarchy: 3 })
      // privilege escalation check: inviter has hierarchy 1 (ADMIN)
      mockTeamMemberFindMany.mockResolvedValueOnce([
        { id: 'tm-1', role: { hierarchy: 1 } },
      ])
      // no existing pending invite
      mockFindFirst.mockResolvedValueOnce(null)
      // no existing user with that email
      mockFindUnique.mockResolvedValueOnce(null)

      const mockInvite = {
        id: 'invite-1',
        email: 'invite@test.com',
        organizationId: 'org-1',
        roleId: 'role-1',
        status: 'pending',
      }
      mockCreate.mockResolvedValueOnce(mockInvite)

      const result = await inviteToOrganization(
        'invite@test.com',
        'org-1',
        'role-1',
        'user-1',
      )

      expect(result).toEqual(mockInvite)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'invite@test.com',
            organizationId: 'org-1',
            roleId: 'role-1',
            invitedById: 'user-1',
            status: 'pending',
          }),
        }),
      )

      // Verify expiration is approximately 7 days from now
      const createCall = mockCreate.mock.calls[0][0]
      const expiresAt = new Date(createCall.data.expiresAt)
      const now = new Date()
      const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      expect(diffDays).toBeGreaterThan(6.9)
      expect(diffDays).toBeLessThan(7.1)
    })
  })

  describe('acceptInvite', () => {
    it('throws VALIDATION_ERROR when inviteId is empty', async () => {
      await expect(acceptInvite('', 'user-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws NOT_FOUND when invite does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null)

      await expect(acceptInvite('invite-1', 'user-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws CONFLICT when invite is already accepted', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        status: 'accepted',
        email: 'test@test.com',
        organizationId: 'org-1',
      })

      await expect(acceptInvite('invite-1', 'user-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        statusCode: 409,
      })
    })

    it('throws GONE when invite has expired', async () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 1)

      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        status: 'pending',
        email: 'test@test.com',
        organizationId: 'org-1',
        expiresAt: pastDate,
      })
      mockUpdate.mockResolvedValueOnce({})

      await expect(acceptInvite('invite-1', 'user-1')).rejects.toMatchObject({
        code: 'GONE',
        statusCode: 410,
      })
    })

    it('throws FORBIDDEN when user email does not match invite email', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 5)

      // invite findUnique
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        status: 'pending',
        email: 'invited@test.com',
        organizationId: 'org-1',
        roleId: 'role-1',
        teamId: 'team-1',
        expiresAt: futureDate,
      })
      // user findUnique
      mockFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'different@test.com',
      })

      await expect(acceptInvite('invite-1', 'user-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      })
    })

    it('creates membership and team member on successful acceptance', async () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 5)

      // invite findUnique
      mockFindUnique.mockResolvedValueOnce({
        id: 'invite-1',
        status: 'pending',
        email: 'test@test.com',
        organizationId: 'org-1',
        roleId: 'role-1',
        teamId: 'team-1',
        expiresAt: futureDate,
      })
      // user findUnique
      mockFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
      })
      // existing membership check → null (not already a member)
      mockFindUnique.mockResolvedValueOnce(null)

      const mockMembership = { id: 'om-1', userId: 'user-1', organizationId: 'org-1' }
      const mockTeamMember = { id: 'tm-1', userId: 'user-1', teamId: 'team-1', roleId: 'role-1' }

      mockTransaction.mockImplementation(async (callback: any) => {
        const tx = {
          organizationMember: {
            findMany: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockResolvedValue(mockMembership),
          },
          teamMember: {
            create: vi.fn().mockResolvedValue(mockTeamMember),
          },
          team: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          organizationInvite: {
            update: vi.fn().mockResolvedValue({}),
          },
        }
        return callback(tx)
      })

      const result = await acceptInvite('invite-1', 'user-1')

      expect(result.membership).toEqual(mockMembership)
      expect(result.teamMember).toEqual(mockTeamMember)
    })
  })
})
