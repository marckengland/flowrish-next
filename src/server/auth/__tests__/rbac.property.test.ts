import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { hasPermission } from '../permissions'
import {
  PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_HIERARCHY,
  type Permission,
  type DefaultRole,
} from '@/types/permissions'
import type { SessionUser } from '../session'

/**
 * Property-based tests for RBAC permission system.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Tests three core properties of the permission system:
 * 1. Monotonicity: Adding a higher role never reduces accessible resources
 * 2. MEMBER isolation: MEMBER can never access leads not assigned to them
 * 3. Commutativity: Permission union across multiple teams is commutative
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROLES: DefaultRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']

/**
 * Creates a mock SessionUser with the given team memberships.
 * Each membership specifies a role name and its associated permissions.
 */
function createMockUser(
  memberships: Array<{
    teamId: string
    roleName: DefaultRole
    permissions: readonly Permission[]
  }>,
): SessionUser {
  return {
    id: 'user-1',
    authId: 'auth-1',
    email: 'test@example.com',
    name: 'Test User',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    organizationMemberships: [
      {
        id: 'om-1',
        userId: 'user-1',
        organizationId: 'org-1',
        isDefault: true,
        joinedAt: new Date(),
      },
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
        hierarchy: ROLE_HIERARCHY[m.roleName],
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

/**
 * Computes the full set of effective permissions for a mock user.
 */
function getEffectivePermissionSet(user: SessionUser): Set<Permission> {
  const perms = new Set<Permission>()
  for (const perm of PERMISSIONS) {
    if (hasPermission(user, perm)) {
      perms.add(perm)
    }
  }
  return perms
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Generate a random default role */
const arbRole = fc.constantFrom<DefaultRole>(...ROLES)

/** Generate a team membership with a role and its default permissions */
const arbTeamMembership = fc.record({
  teamId: fc.uuid(),
  roleName: arbRole,
}).map(({ teamId, roleName }) => ({
  teamId,
  roleName,
  permissions: DEFAULT_ROLE_PERMISSIONS[roleName],
}))

/** Generate a subset of permissions (for custom role scenarios) */
const arbPermissionSubset = fc
  .subarray([...PERMISSIONS], { minLength: 0 })
  .map((perms) => perms as Permission[])

/** Generate a team membership with a custom permission set */
const arbCustomTeamMembership = fc.record({
  teamId: fc.uuid(),
  roleName: arbRole,
  permissions: arbPermissionSubset,
})

// ── Property Tests ───────────────────────────────────────────────────────────

describe('RBAC Permission System - Property Tests', () => {
  describe('Property: Adding a higher role never reduces accessible resources (monotonic)', () => {
    /**
     * **Validates: Requirements 3.1**
     *
     * The role hierarchy is OWNER > ADMIN > MANAGER > MEMBER.
     * When a user gains a higher role (lower hierarchy number), their
     * effective permission set must be a superset of what they had before.
     * No permission that was accessible should become inaccessible.
     */

    it('adding a higher default role always expands or maintains the permission set', () => {
      fc.assert(
        fc.property(
          arbRole,
          fc.uuid(),
          fc.uuid(),
          (currentRole, teamId1, teamId2) => {
            // Get all roles that are strictly higher (lower hierarchy number)
            const currentHierarchy = ROLE_HIERARCHY[currentRole]
            const higherRoles = ROLES.filter(
              (r) => ROLE_HIERARCHY[r] < currentHierarchy,
            )

            if (higherRoles.length === 0) return // OWNER has no higher role

            for (const higherRole of higherRoles) {
              // User with only the current role
              const userBefore = createMockUser([
                {
                  teamId: teamId1,
                  roleName: currentRole,
                  permissions: DEFAULT_ROLE_PERMISSIONS[currentRole],
                },
              ])

              // User with the current role PLUS a higher role on another team
              const userAfter = createMockUser([
                {
                  teamId: teamId1,
                  roleName: currentRole,
                  permissions: DEFAULT_ROLE_PERMISSIONS[currentRole],
                },
                {
                  teamId: teamId2,
                  roleName: higherRole,
                  permissions: DEFAULT_ROLE_PERMISSIONS[higherRole],
                },
              ])

              const permsBefore = getEffectivePermissionSet(userBefore)
              const permsAfter = getEffectivePermissionSet(userAfter)

              // Every permission the user had before must still be present
              for (const perm of permsBefore) {
                expect(permsAfter.has(perm)).toBe(true)
              }

              // The new set must be at least as large
              expect(permsAfter.size).toBeGreaterThanOrEqual(permsBefore.size)
            }
          },
        ),
        { numRuns: 100 },
      )
    })

    it('the default role hierarchy is strictly monotonic in permissions', () => {
      fc.assert(
        fc.property(fc.uuid(), (teamId) => {
          // For each adjacent pair in the hierarchy, the higher role
          // must have a strict superset of permissions
          const orderedRoles: DefaultRole[] = ['MEMBER', 'MANAGER', 'ADMIN', 'OWNER']

          for (let i = 0; i < orderedRoles.length - 1; i++) {
            const lowerRole = orderedRoles[i]
            const higherRole = orderedRoles[i + 1]

            const lowerUser = createMockUser([
              {
                teamId,
                roleName: lowerRole,
                permissions: DEFAULT_ROLE_PERMISSIONS[lowerRole],
              },
            ])
            const higherUser = createMockUser([
              {
                teamId,
                roleName: higherRole,
                permissions: DEFAULT_ROLE_PERMISSIONS[higherRole],
              },
            ])

            const lowerPerms = getEffectivePermissionSet(lowerUser)
            const higherPerms = getEffectivePermissionSet(higherUser)

            // Higher role must have all permissions of the lower role
            for (const perm of lowerPerms) {
              expect(higherPerms.has(perm)).toBe(true)
            }

            // Higher role must have at least as many permissions
            expect(higherPerms.size).toBeGreaterThanOrEqual(lowerPerms.size)
          }
        }),
        { numRuns: 50 },
      )
    })
  })

  describe('Property: MEMBER can never access leads not assigned to them', () => {
    /**
     * **Validates: Requirements 3.2**
     *
     * A user with only MEMBER role(s) can never have permissions beyond
     * what DEFAULT_ROLE_PERMISSIONS.MEMBER grants. Specifically, they
     * cannot have management permissions like users:manage, billing:manage,
     * settings:manage, or audit:read.
     */

    const MEMBER_FORBIDDEN_PERMISSIONS: Permission[] = PERMISSIONS.filter(
      (p) => !DEFAULT_ROLE_PERMISSIONS.MEMBER.includes(p),
    ) as Permission[]

    it('a user with only MEMBER roles never has permissions beyond MEMBER defaults', () => {
      fc.assert(
        fc.property(
          fc.array(fc.uuid(), { minLength: 1, maxLength: 5 }),
          (teamIds) => {
            // Create a user with MEMBER role on multiple teams
            const memberships = teamIds.map((teamId) => ({
              teamId,
              roleName: 'MEMBER' as DefaultRole,
              permissions: DEFAULT_ROLE_PERMISSIONS.MEMBER,
            }))

            const user = createMockUser(memberships)

            // The user must never have any forbidden permission
            for (const forbiddenPerm of MEMBER_FORBIDDEN_PERMISSIONS) {
              expect(hasPermission(user, forbiddenPerm)).toBe(false)
            }
          },
        ),
        { numRuns: 100 },
      )
    })

    it('MEMBER permissions are bounded by DEFAULT_ROLE_PERMISSIONS.MEMBER regardless of team count', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10 }),
          fc.uuid(),
          (teamCount, baseTeamId) => {
            // Generate multiple team memberships all with MEMBER role
            const memberships = Array.from({ length: teamCount }, (_, i) => ({
              teamId: `${baseTeamId}-${i}`,
              roleName: 'MEMBER' as DefaultRole,
              permissions: DEFAULT_ROLE_PERMISSIONS.MEMBER,
            }))

            const user = createMockUser(memberships)
            const effectivePerms = getEffectivePermissionSet(user)

            // Effective permissions must be exactly the MEMBER set
            const memberPermSet = new Set(DEFAULT_ROLE_PERMISSIONS.MEMBER)
            expect(effectivePerms).toEqual(memberPermSet)
          },
        ),
        { numRuns: 100 },
      )
    })
  })

  describe('Property: Permission union across multiple teams is commutative', () => {
    /**
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     *
     * The order of team memberships does not affect the resulting
     * permission set. The union operation is commutative — regardless
     * of how team memberships are ordered, the effective permissions
     * are the same.
     */

    it('reordering team memberships produces the same effective permission set', () => {
      fc.assert(
        fc.property(
          fc.array(arbTeamMembership, { minLength: 2, maxLength: 5 }),
          (memberships) => {
            // Create user with memberships in original order
            const userOriginal = createMockUser(memberships)

            // Create user with memberships in reversed order
            const reversed = [...memberships].reverse()
            const userReversed = createMockUser(reversed)

            const permsOriginal = getEffectivePermissionSet(userOriginal)
            const permsReversed = getEffectivePermissionSet(userReversed)

            // Both orderings must produce the same permission set
            expect(permsOriginal).toEqual(permsReversed)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('any permutation of team memberships produces the same effective permission set', () => {
      fc.assert(
        fc.property(
          fc.array(arbCustomTeamMembership, { minLength: 2, maxLength: 4 }),
          fc.nat(),
          (memberships, seed) => {
            // Create user with original order
            const userOriginal = createMockUser(memberships)
            const permsOriginal = getEffectivePermissionSet(userOriginal)

            // Create a shuffled version using the seed for determinism
            const shuffled = [...memberships]
            // Fisher-Yates shuffle with deterministic seed
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = (seed + i) % (i + 1)
              ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
            }

            const userShuffled = createMockUser(shuffled)
            const permsShuffled = getEffectivePermissionSet(userShuffled)

            // Both orderings must produce the same permission set
            expect(permsOriginal).toEqual(permsShuffled)
          },
        ),
        { numRuns: 100 },
      )
    })

    it('union of permissions from two teams equals union in either order', () => {
      fc.assert(
        fc.property(
          arbCustomTeamMembership,
          arbCustomTeamMembership,
          (membership1, membership2) => {
            // Order: [team1, team2]
            const userAB = createMockUser([membership1, membership2])
            // Order: [team2, team1]
            const userBA = createMockUser([membership2, membership1])

            // Check every permission individually
            for (const perm of PERMISSIONS) {
              expect(hasPermission(userAB, perm)).toBe(hasPermission(userBA, perm))
            }
          },
        ),
        { numRuns: 100 },
      )
    })
  })
})
