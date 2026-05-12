import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'

// Mock the Prisma client singleton to avoid ESM import issues with generated client.
// We capture the $extends config to test the query extension functions directly.
let capturedExtensionConfig: any = null

const { mockExtends } = vi.hoisted(() => {
  const mockExtends = vi.fn().mockImplementation((config: any) => {
    capturedExtensionConfig = config
    return {
      lead: {},
      contact: {},
      company: {},
      organization: {},
      user: {},
      $extends: mockExtends,
    }
  })
  return { mockExtends }
})

vi.mock('../client', () => ({
  prisma: {
    lead: {},
    contact: {},
    company: {},
    organization: {},
    user: {},
    $extends: mockExtends,
  },
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

import { TENANT_SCOPED_MODELS, createTenantPrisma } from '../middleware'

/**
 * Property-based tests for tenant isolation middleware.
 * **Validates: Requirements 2.1, 2.2**
 */
describe('Tenant Isolation Middleware - Property Tests', () => {
  /** Non-tenant models that should pass through unmodified */
  const NON_TENANT_MODELS = [
    'Organization',
    'OrganizationMember',
    'OrganizationInvite',
    'Team',
    'TeamMember',
    'Role',
    'RolePermission',
    'User',
    'LeadContact',
  ] as const

  /**
   * Helper: creates a tenant prisma client and returns the captured extension config.
   */
  function getExtensionHandlers(organizationId: string) {
    mockExtends.mockClear()
    capturedExtensionConfig = null
    createTenantPrisma(organizationId)
    return capturedExtensionConfig?.query?.$allModels
  }

  describe('Property: organizationId injection invariant', () => {
    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * For any tenant-scoped model operation, the resulting query always
     * contains the correct organizationId.
     */

    it('create operations always inject organizationId into data for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
          (orgId, model, inputData) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { data: { ...inputData } }
            handlers.create({ model, args, query: mockQuery })

            // The data passed to query must contain the correct organizationId
            expect(queriedArgs.data.organizationId).toBe(orgId)
          }
        )
      )
    })

    it('createMany operations always inject organizationId into each item for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.array(
            fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
            { minLength: 1, maxLength: 5 }
          ),
          (orgId, model, items) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { data: [...items] }
            handlers.createMany({ model, args, query: mockQuery })

            // Every item in the data array must have organizationId
            const data = queriedArgs.data
            expect(Array.isArray(data)).toBe(true)
            for (const item of data) {
              expect(item.organizationId).toBe(orgId)
            }
          }
        )
      )
    })

    it('findMany operations always inject organizationId into where clause for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
          (orgId, model, existingWhere) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve([])
            }

            const args = { where: { ...existingWhere } }
            handlers.findMany({ model, args, query: mockQuery })

            expect(queriedArgs.where.organizationId).toBe(orgId)
          }
        )
      )
    })

    it('findFirst operations always inject organizationId into where clause for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
          (orgId, model, existingWhere) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve(null)
            }

            const args = { where: { ...existingWhere } }
            handlers.findFirst({ model, args, query: mockQuery })

            expect(queriedArgs.where.organizationId).toBe(orgId)
          }
        )
      )
    })

    it('update operations always inject organizationId into where clause for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.uuid(),
          (orgId, model, recordId) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { where: { id: recordId }, data: { name: 'updated' } }
            handlers.update({ model, args, query: mockQuery })

            expect(queriedArgs.where.organizationId).toBe(orgId)
          }
        )
      )
    })

    it('delete operations always inject organizationId into where clause for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.uuid(),
          (orgId, model, recordId) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { where: { id: recordId } }
            handlers.delete({ model, args, query: mockQuery })

            expect(queriedArgs.where.organizationId).toBe(orgId)
          }
        )
      )
    })

    it('count operations always inject organizationId into where clause for tenant-scoped models', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
          (orgId, model, existingWhere) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve(0)
            }

            const args = { where: { ...existingWhere } }
            handlers.count({ model, args, query: mockQuery })

            expect(queriedArgs.where.organizationId).toBe(orgId)
          }
        )
      )
    })

    it('organizationId in query always matches the one provided to createTenantPrisma', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...TENANT_SCOPED_MODELS),
          fc.constantFrom(
            'findMany', 'findFirst', 'update', 'updateMany',
            'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'
          ),
          (orgId, model, operation) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve(operation === 'findMany' ? [] : null)
            }

            const args = { where: { someField: 'value' } }
            handlers[operation]({ model, args, query: mockQuery })

            // The organizationId in the where clause must always be the one
            // provided when creating the tenant prisma client
            expect(queriedArgs.where.organizationId).toBe(orgId)
          }
        )
      )
    })
  })

  describe('Property: Non-tenant models pass through', () => {
    /**
     * **Validates: Requirements 2.1, 2.2**
     *
     * Operations on non-tenant-scoped models are unmodified — no organizationId
     * is injected into their queries or data.
     */

    it('create operations on non-tenant models do not inject organizationId', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...NON_TENANT_MODELS),
          fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
          (orgId, model, inputData) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { data: { ...inputData } }
            handlers.create({ model, args, query: mockQuery })

            // Non-tenant models should NOT have organizationId injected
            expect(queriedArgs.data.organizationId).toBeUndefined()
          }
        )
      )
    })

    it('createMany operations on non-tenant models do not inject organizationId', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...NON_TENANT_MODELS),
          fc.array(
            fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
            { minLength: 1, maxLength: 5 }
          ),
          (orgId, model, items) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { data: [...items] }
            handlers.createMany({ model, args, query: mockQuery })

            // Non-tenant models: data should remain unchanged
            const data = queriedArgs.data
            if (Array.isArray(data)) {
              for (const item of data) {
                expect(item.organizationId).toBeUndefined()
              }
            } else {
              expect(data.organizationId).toBeUndefined()
            }
          }
        )
      )
    })

    it('read operations on non-tenant models do not inject organizationId into where', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...NON_TENANT_MODELS),
          fc.constantFrom('findMany', 'findFirst', 'count', 'aggregate', 'groupBy'),
          fc.dictionary(fc.string().filter(s => s.length > 0 && s !== 'organizationId'), fc.string()),
          (orgId, model, operation, existingWhere) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve(operation === 'findMany' ? [] : null)
            }

            const args = { where: { ...existingWhere } }
            handlers[operation]({ model, args, query: mockQuery })

            // Non-tenant models should NOT have organizationId in where clause
            expect(queriedArgs.where.organizationId).toBeUndefined()
          }
        )
      )
    })

    it('update/delete operations on non-tenant models do not inject organizationId', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...NON_TENANT_MODELS),
          fc.constantFrom('update', 'updateMany', 'delete', 'deleteMany'),
          fc.uuid(),
          (orgId, model, operation, recordId) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve({})
            }

            const args = { where: { id: recordId }, ...(operation.startsWith('update') ? { data: { name: 'x' } } : {}) }
            handlers[operation]({ model, args, query: mockQuery })

            // Non-tenant models should NOT have organizationId in where clause
            expect(queriedArgs.where.organizationId).toBeUndefined()
          }
        )
      )
    })

    it('non-tenant model args are passed through completely unmodified', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.constantFrom(...NON_TENANT_MODELS),
          fc.uuid(),
          fc.string(),
          (orgId, model, recordId, fieldValue) => {
            const handlers = getExtensionHandlers(orgId)
            let queriedArgs: any = null

            const mockQuery = (args: any) => {
              queriedArgs = args
              return Promise.resolve([])
            }

            const originalWhere = { id: recordId, name: fieldValue }
            const args = { where: { ...originalWhere } }
            handlers.findMany({ model, args, query: mockQuery })

            // The where clause should be exactly what was passed in (no additions)
            expect(queriedArgs.where).toEqual(originalWhere)
          }
        )
      )
    })
  })
})
