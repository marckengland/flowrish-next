import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for multi-tenancy isolation.
 *
 * These tests verify that:
 * 1. A user can never read data from an Organization they are not a member of
 * 2. Adding a user to a Team never grants access to a different Organization
 * 3. organizationId is always derived server-side, never from client input
 *
 * **Validates: Requirements 2.1, 2.2, 2.9**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Track the extension config to test tenant isolation behavior
let capturedExtensionConfig: any = null

const { mockExtends } = vi.hoisted(() => {
  const mockExtends = vi.fn().mockImplementation((config: any) => {
    capturedExtensionConfig = config
    return {
      lead: {},
      contact: {},
      company: {},
      $extends: mockExtends,
    }
  })
  return { mockExtends }
})

vi.mock('@/server/db/client', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    team: { findMany: vi.fn(), findUnique: vi.fn() },
    teamMember: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    organizationMember: { findMany: vi.fn(), findUnique: vi.fn() },
    $extends: mockExtends,
    $transaction: vi.fn(),
  },
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { createTenantPrisma, TENANT_SCOPED_MODELS } from '@/server/db/middleware'
import { prisma } from '@/server/db/client'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID for organization IDs */
const orgIdArb = fc.uuid()

/** Generate a valid UUID for user IDs */
const userIdArb = fc.uuid()

/** Generate a valid UUID for team IDs */
const teamIdArb = fc.uuid()

/** Generate a valid UUID for role IDs */
const roleIdArb = fc.uuid()

/**
 * Generate a pair of distinct organization IDs (orgA ≠ orgB).
 * This represents two different tenants that must be isolated.
 */
const distinctOrgPairArb = fc.tuple(orgIdArb, orgIdArb).filter(
  ([a, b]) => a !== b,
)

/**
 * Generate a user membership scenario:
 * - userId: the user
 * - memberOrgId: the org the user belongs to
 * - otherOrgId: a different org the user does NOT belong to
 */
const membershipScenarioArb = fc.record({
  userId: userIdArb,
  memberOrgId: orgIdArb,
  otherOrgId: orgIdArb,
}).filter((s) => s.memberOrgId !== s.otherOrgId)

/**
 * Generate a team membership addition scenario:
 * - userId: the user being added
 * - teamId: the team being added to
 * - teamOrgId: the org the team belongs to
 * - otherOrgId: a different org that should remain inaccessible
 * - roleId: the role being assigned
 */
const teamAdditionScenarioArb = fc.record({
  userId: userIdArb,
  teamId: teamIdArb,
  teamOrgId: orgIdArb,
  otherOrgId: orgIdArb,
  roleId: roleIdArb,
}).filter((s) => s.teamOrgId !== s.otherOrgId)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Multi-Tenancy Isolation - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedExtensionConfig = null
  })

  /**
   * Helper: creates a tenant prisma client and returns the captured extension handlers.
   */
  function getExtensionHandlers(organizationId: string) {
    mockExtends.mockClear()
    capturedExtensionConfig = null
    createTenantPrisma(organizationId)
    return capturedExtensionConfig?.query?.$allModels
  }

  describe('Property: A user can never read data from an Organization they are not a member of', () => {
    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * The tenant-scoped Prisma client always filters queries by the
     * organizationId it was created with. A user whose session resolves
     * to orgA can never see data belonging to orgB, because the middleware
     * injects orgA into every query's where clause.
     */

    it('tenant prisma client for orgA never returns data with orgB organizationId in queries', () => {
      fc.assert(
        fc.property(
          distinctOrgPairArb,
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.constantFrom('findMany', 'findFirst', 'count', 'aggregate', 'groupBy'),
          ([orgA, orgB], model, operation) => {
            const handlers = getExtensionHandlers(orgA)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve(operation === 'findMany' ? [] : null)
            }

            // Even if someone tries to pass orgB in the where clause,
            // the middleware overwrites it with orgA
            const args = { where: { organizationId: orgB, someField: 'value' } }
            handlers[operation]({ model, args, query: mockQuery })

            // The query MUST use orgA (the session org), not orgB
            expect(queriedArgs.where.organizationId).toBe(orgA)
            expect(queriedArgs.where.organizationId).not.toBe(orgB)
          },
        ),
      )
    })

    it('tenant prisma client scoped to orgA cannot read records from orgB even with explicit orgB filter', () => {
      fc.assert(
        fc.property(
          membershipScenarioArb,
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          (scenario, model) => {
            // User is a member of memberOrgId — their session creates a
            // tenant prisma client scoped to memberOrgId
            const handlers = getExtensionHandlers(scenario.memberOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve([])
            }

            // Attempt to query with the other org's ID
            const args = { where: { organizationId: scenario.otherOrgId } }
            handlers.findMany({ model, args, query: mockQuery })

            // The middleware enforces the session org, blocking cross-tenant access
            expect(queriedArgs.where.organizationId).toBe(scenario.memberOrgId)
            expect(queriedArgs.where.organizationId).not.toBe(scenario.otherOrgId)
          },
        ),
      )
    })

    it('update/delete operations on tenant models are always scoped to the session org', () => {
      fc.assert(
        fc.property(
          distinctOrgPairArb,
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.constantFrom('update', 'updateMany', 'delete', 'deleteMany'),
          fc.uuid(),
          ([orgA, orgB], model, operation, recordId) => {
            const handlers = getExtensionHandlers(orgA)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            // Attempt to modify a record with orgB in the where clause
            const args = {
              where: { id: recordId, organizationId: orgB },
              ...(operation.startsWith('update') ? { data: { name: 'hacked' } } : {}),
            }
            handlers[operation]({ model, args, query: mockQuery })

            // The middleware enforces orgA, preventing cross-tenant mutations
            expect(queriedArgs.where.organizationId).toBe(orgA)
            expect(queriedArgs.where.organizationId).not.toBe(orgB)
          },
        ),
      )
    })
  })

  describe('Property: Adding a user to a Team never grants access to a different Organization', () => {
    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * When a user is added to a team in Organization A, the tenant prisma
     * client they receive is always scoped to Organization A. This means
     * they can never access data in Organization B through that client,
     * regardless of what team or role they are assigned.
     */

    it('a tenant client created for the team org never allows queries against a different org', () => {
      fc.assert(
        fc.property(
          teamAdditionScenarioArb,
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          (scenario, model) => {
            // After adding user to team in teamOrgId, their session resolves
            // to teamOrgId — the tenant client is scoped to teamOrgId
            const handlers = getExtensionHandlers(scenario.teamOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve([])
            }

            // Try to access data from the other org
            const args = { where: { organizationId: scenario.otherOrgId } }
            handlers.findMany({ model, args, query: mockQuery })

            // The client is locked to teamOrgId — otherOrgId is inaccessible
            expect(queriedArgs.where.organizationId).toBe(scenario.teamOrgId)
            expect(queriedArgs.where.organizationId).not.toBe(scenario.otherOrgId)
          },
        ),
      )
    })

    it('creating records after team addition always stamps the team org, not any other org', () => {
      fc.assert(
        fc.property(
          teamAdditionScenarioArb,
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.dictionary(
            fc.string().filter((s) => s.length > 0 && s !== 'organizationId'),
            fc.string(),
          ),
          (scenario, model, recordData) => {
            // User was added to a team in teamOrgId — their tenant client
            // is scoped to teamOrgId
            const handlers = getExtensionHandlers(scenario.teamOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            // Even if the data payload tries to set a different organizationId
            const args = { data: { ...recordData, organizationId: scenario.otherOrgId } }
            handlers.create({ model, args, query: mockQuery })

            // The middleware always overwrites with the session org
            expect(queriedArgs.data.organizationId).toBe(scenario.teamOrgId)
            expect(queriedArgs.data.organizationId).not.toBe(scenario.otherOrgId)
          },
        ),
      )
    })

    it('team membership in orgA with any role hierarchy never leaks access to orgB', () => {
      fc.assert(
        fc.property(
          teamAdditionScenarioArb,
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.integer({ min: 0, max: 3 }), // role hierarchy: 0=OWNER, 1=ADMIN, 2=MANAGER, 3=MEMBER
          (scenario, model, _roleHierarchy) => {
            // Regardless of the role hierarchy (even OWNER), the tenant
            // client is scoped to the team's org — not any other org
            const handlers = getExtensionHandlers(scenario.teamOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve([])
            }

            const args = { where: {} }
            handlers.findMany({ model, args, query: mockQuery })

            // Access is always limited to the team's organization
            expect(queriedArgs.where.organizationId).toBe(scenario.teamOrgId)
          },
        ),
      )
    })
  })

  describe('Property: organizationId is always derived server-side, never from client input', () => {
    /**
     * **Validates: Requirements 2.9**
     *
     * The session utility resolves organizationId from the user's
     * organization membership (server-side lookup). The tenant middleware
     * then uses this server-derived organizationId to scope all queries.
     * Any client-provided organizationId in request params or body is
     * overwritten by the middleware.
     */

    it('any client-provided organizationId in create data is overwritten by the server-derived org', () => {
      fc.assert(
        fc.property(
          orgIdArb, // server-derived org from session
          orgIdArb, // client-attempted org (could be same or different)
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.dictionary(
            fc.string().filter((s) => s.length > 0 && s !== 'organizationId'),
            fc.string(),
          ),
          (serverOrgId, clientOrgId, model, otherFields) => {
            const handlers = getExtensionHandlers(serverOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            // Client tries to inject their own organizationId
            const args = { data: { ...otherFields, organizationId: clientOrgId } }
            handlers.create({ model, args, query: mockQuery })

            // The middleware ALWAYS uses the server-derived organizationId
            expect(queriedArgs.data.organizationId).toBe(serverOrgId)
          },
        ),
      )
    })

    it('any client-provided organizationId in query filters is overwritten by the server-derived org', () => {
      fc.assert(
        fc.property(
          orgIdArb, // server-derived org from session
          orgIdArb, // client-attempted org filter
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.constantFrom('findMany', 'findFirst', 'count', 'aggregate', 'groupBy'),
          (serverOrgId, clientOrgId, model, operation) => {
            const handlers = getExtensionHandlers(serverOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve(operation === 'findMany' ? [] : null)
            }

            // Client tries to filter by a different organizationId
            const args = { where: { organizationId: clientOrgId, status: 'active' } }
            handlers[operation]({ model, args, query: mockQuery })

            // The middleware ALWAYS uses the server-derived organizationId
            expect(queriedArgs.where.organizationId).toBe(serverOrgId)
          },
        ),
      )
    })

    it('createMany with client-injected organizationId in items is overwritten for all items', () => {
      fc.assert(
        fc.property(
          orgIdArb, // server-derived org
          fc.array(
            fc.record({
              name: fc.string(),
              organizationId: orgIdArb, // client-injected per item
            }),
            { minLength: 1, maxLength: 5 },
          ),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          (serverOrgId, items, model) => {
            const handlers = getExtensionHandlers(serverOrgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { data: [...items] }
            handlers.createMany({ model, args, query: mockQuery })

            // Every item must have the server-derived organizationId
            const data = queriedArgs.data
            expect(Array.isArray(data)).toBe(true)
            for (const item of data) {
              expect(item.organizationId).toBe(serverOrgId)
            }
          },
        ),
      )
    })

    it('session organizationId is determined by membership, not by any client-supplied value in queries', () => {
      /**
       * This test verifies the design contract: once the tenant prisma client
       * is created with a server-derived organizationId (from getSession()),
       * no client-supplied value can override it. The organizationId in the
       * final query is ALWAYS the one provided at client creation time,
       * regardless of what values appear in the args.
       *
       * This proves that even if a malicious client could somehow inject
       * an organizationId into request params/body, the middleware would
       * overwrite it with the server-derived value.
       */
      fc.assert(
        fc.property(
          orgIdArb, // server-derived org (from session membership)
          fc.array(orgIdArb, { minLength: 1, maxLength: 5 }), // multiple client-attempted orgs
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          (serverOrgId, clientAttemptedOrgs, model) => {
            const handlers = getExtensionHandlers(serverOrgId)

            // Try each client-attempted org — none should succeed
            for (const clientOrgId of clientAttemptedOrgs) {
              let queriedArgs: any = null

              const mockQuery = (args: any) => {
                queriedArgs = args
                return Promise.resolve([])
              }

              const args = { where: { organizationId: clientOrgId } }
              handlers.findMany({ model, args, query: mockQuery })

              // The server-derived org ALWAYS wins
              expect(queriedArgs.where.organizationId).toBe(serverOrgId)
            }
          },
        ),
      )
    })

    it('createTenantPrisma requires a non-empty organizationId (rejects empty/falsy values)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', null, undefined),
          (invalidOrgId) => {
            // The middleware rejects falsy organizationId values,
            // ensuring a valid server-derived org is always required
            expect(() => createTenantPrisma(invalidOrgId as any)).toThrow()
          },
        ),
      )
    })
  })
})
