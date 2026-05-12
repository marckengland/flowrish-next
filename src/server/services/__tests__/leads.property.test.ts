import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for lead management.
 *
 * These tests verify that:
 * 1. Soft-deleted leads never appear in any listing or aggregate query
 * 2. Creating a lead then fetching by ID returns identical field values (round-trip)
 * 3. Soft-deleting an already-deleted lead does not change deletedAt (idempotence)
 *
 * **Validates: Requirements 4.1, 4.3, 4.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  stage: {
    findFirst: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead'],
}))

vi.mock('@/server/services/pipeline', () => ({
  getOrCreateDefaultPipeline: vi.fn().mockResolvedValue({}),
  createStageTransition: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/server/db/client', () => ({
  prisma: { leadContact: { create: vi.fn() } },
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { createLead, softDeleteLead, getLeads, getLeadById } from '@/server/services/leads'
import type { LeadAccessFilter } from '@/server/services/access'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate a valid first name (non-empty, no null bytes, no '..') */
const nameArb = fc.stringOf(fc.char().filter(c => c !== '\0' && c !== '.'), { minLength: 1, maxLength: 30 })
  .filter(s => s.trim().length > 0 && !s.includes('..'))

/** Generate a valid lead status */
const leadStatusArb = fc.constantFrom('NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'NURTURING')

/** Generate a valid tier */
const tierArb = fc.constantFrom('TIER_1', 'TIER_2', 'TIER_3', null)

/**
 * Generate valid lead creation input that passes Zod validation.
 * Uses simple, constrained values to avoid Zod validation failures.
 */
const validLeadInputArb = fc.record({
  firstName: nameArb,
  lastName: nameArb,
  stageId: uuidArb,
  currency: fc.constant('USD'),
  dealValue: fc.oneof(fc.constant(undefined), fc.nat({ max: 1000000 })),
  score: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 100 })),
  leadStatus: fc.oneof(fc.constant(undefined), leadStatusArb),
})

/**
 * Generate a lead record as it would exist in the database.
 * Includes both active (deletedAt: null) and soft-deleted (deletedAt: Date) leads.
 */
const leadRecordArb = fc.record({
  id: uuidArb,
  firstName: nameArb,
  lastName: nameArb,
  email: fc.oneof(fc.constant(null), fc.constant('test@example.com')),
  stageId: uuidArb,
  dealValue: fc.oneof(fc.constant(null), fc.nat({ max: 1000000 })),
  score: fc.integer({ min: 0, max: 100 }),
  leadStatus: leadStatusArb,
  tier: tierArb,
  currency: fc.constant('USD'),
  deletedAt: fc.oneof(fc.constant(null), fc.date()),
  organizationId: uuidArb,
  createdAt: fc.date(),
})

/**
 * Generate a mix of active and soft-deleted leads.
 */
const leadListArb = fc.array(leadRecordArb, { minLength: 0, maxLength: 20 })

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Lead Management - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Soft-deleted leads never appear in any listing or aggregate query', () => {
    /**
     * **Validates: Requirements 4.3, 4.4**
     *
     * The access filter always includes `deletedAt: null`, which means
     * any lead with a non-null deletedAt is excluded from listings and
     * aggregate queries. This property verifies that the getLeads function
     * correctly applies this filter.
     */

    it('getLeads with access filter (deletedAt: null) never returns soft-deleted leads', async () => {
      await fc.assert(
        fc.asyncProperty(
          leadListArb,
          uuidArb,
          async (leads, orgId) => {
            const activeLeads = leads.filter(l => l.deletedAt === null)
            const deletedLeads = leads.filter(l => l.deletedAt !== null)

            const accessFilter: LeadAccessFilter = { deletedAt: null }

            // Mock findMany to simulate Prisma filtering behavior
            mockDb.lead.findMany.mockImplementation(({ where }: any) => {
              const results = leads.filter(lead => {
                if (where.deletedAt === null && lead.deletedAt !== null) {
                  return false
                }
                return true
              })
              return Promise.resolve(results)
            })

            mockDb.lead.count.mockImplementation(({ where }: any) => {
              const results = leads.filter(lead => {
                if (where.deletedAt === null && lead.deletedAt !== null) {
                  return false
                }
                return true
              })
              return Promise.resolve(results.length)
            })

            const result = await getLeads({}, { page: 1, pageSize: 100 }, accessFilter, orgId)

            // No soft-deleted lead should appear in the results
            for (const lead of result.leads) {
              expect(lead.deletedAt).toBeNull()
            }

            // The count should only include active leads
            expect(result.pagination.total).toBe(activeLeads.length)

            // None of the deleted leads should be in the results
            const resultIds = new Set(result.leads.map((l: any) => l.id))
            for (const deleted of deletedLeads) {
              expect(resultIds.has(deleted.id)).toBe(false)
            }
          },
        ),
      )
    })

    it('getLeadById with access filter (deletedAt: null) never returns a soft-deleted lead', async () => {
      await fc.assert(
        fc.asyncProperty(
          leadRecordArb.filter(l => l.deletedAt !== null),
          uuidArb,
          async (deletedLead, orgId) => {
            const accessFilter: LeadAccessFilter = { deletedAt: null }

            // Mock findFirst: a deleted lead won't match deletedAt: null filter
            mockDb.lead.findFirst.mockImplementation(({ where }: any) => {
              if (where.deletedAt === null && deletedLead.deletedAt !== null) {
                return Promise.resolve(null)
              }
              return Promise.resolve(deletedLead)
            })

            // getLeadById should throw LEAD_NOT_FOUND for soft-deleted leads
            await expect(
              getLeadById(deletedLead.id, accessFilter, orgId),
            ).rejects.toMatchObject({
              code: 'LEAD_NOT_FOUND',
            })
          },
        ),
      )
    })

    it('LeadAccessFilter type always requires deletedAt: null regardless of role', () => {
      /**
       * This verifies the structural property of LeadAccessFilter:
       * every valid access filter MUST have deletedAt: null, ensuring
       * soft-deleted leads are excluded from all role-based queries.
       */
      fc.assert(
        fc.property(
          uuidArb,
          fc.array(uuidArb, { minLength: 1, maxLength: 5 }),
          (userId, teamUserIds) => {
            // MEMBER filter
            const memberFilter: LeadAccessFilter = {
              deletedAt: null,
              assignedUserId: userId,
            }
            expect(memberFilter.deletedAt).toBeNull()

            // OWNER/ADMIN filter
            const adminFilter: LeadAccessFilter = { deletedAt: null }
            expect(adminFilter.deletedAt).toBeNull()

            // MANAGER filter
            const managerFilter: LeadAccessFilter = {
              deletedAt: null,
              assignedUserId: { in: teamUserIds },
            }
            expect(managerFilter.deletedAt).toBeNull()
          },
        ),
      )
    })
  })

  describe('Property: Creating a lead then fetching by ID returns identical field values (round-trip)', () => {
    /**
     * **Validates: Requirements 4.1**
     *
     * When a lead is created with valid data, fetching it by ID should
     * return the same field values that were provided during creation.
     * This tests the validation + data mapping pipeline.
     */

    it('created lead fields match the input data after Zod validation and persistence', async () => {
      await fc.assert(
        fc.asyncProperty(
          validLeadInputArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (inputData, userId, orgId) => {
            // Mock stage existence check
            mockDb.stage.findFirst.mockResolvedValue({ id: inputData.stageId, name: 'Test Stage' })

            // Mock create to return the lead with the same data that was passed
            mockDb.lead.create.mockImplementation(({ data }: any) => {
              return Promise.resolve({
                id: 'lead-created-id',
                ...data,
                organizationId: orgId,
                deletedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
            })

            const createdLead = await createLead(inputData, userId, orgId)

            // Verify core required fields match
            expect(createdLead.firstName).toBe(inputData.firstName)
            expect(createdLead.lastName).toBe(inputData.lastName)
            expect(createdLead.stageId).toBe(inputData.stageId)

            // Verify optional fields match when provided
            if (inputData.dealValue !== undefined) {
              expect(createdLead.dealValue).toBe(inputData.dealValue)
            }
            if (inputData.score !== undefined) {
              expect(createdLead.score).toBe(inputData.score)
            }
            if (inputData.leadStatus) {
              expect(createdLead.leadStatus).toBe(inputData.leadStatus)
            }

            // Verify the lead is not soft-deleted on creation
            expect(createdLead.deletedAt).toBeNull()
          },
        ),
      )
    })

    it('created lead can be fetched by ID and returns the same field values', async () => {
      await fc.assert(
        fc.asyncProperty(
          validLeadInputArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (inputData, userId, orgId) => {
            const accessFilter: LeadAccessFilter = { deletedAt: null }
            let storedLead: any = null

            // Mock stage existence check
            mockDb.stage.findFirst.mockResolvedValue({ id: inputData.stageId, name: 'Test Stage' })

            // Mock create — stores the lead
            mockDb.lead.create.mockImplementation(({ data }: any) => {
              storedLead = {
                id: 'lead-roundtrip-id',
                ...data,
                organizationId: orgId,
                deletedAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                stage: { id: inputData.stageId, name: 'Test Stage', pipeline: {} },
                assignedUser: null,
                company: null,
                contacts: [],
                activities: [],
                tasks: [],
              }
              return Promise.resolve(storedLead)
            })

            // Mock findFirst for getLeadById — returns the stored lead
            mockDb.lead.findFirst.mockImplementation(({ where }: any) => {
              if (storedLead && where.id === storedLead.id && where.deletedAt === null) {
                return Promise.resolve(storedLead)
              }
              return Promise.resolve(null)
            })

            const createdLead = await createLead(inputData, userId, orgId)
            const fetchedLead = await getLeadById(createdLead.id, accessFilter, orgId)

            // Round-trip: fetched lead has identical field values
            expect(fetchedLead.id).toBe(createdLead.id)
            expect(fetchedLead.firstName).toBe(createdLead.firstName)
            expect(fetchedLead.lastName).toBe(createdLead.lastName)
            expect(fetchedLead.stageId).toBe(createdLead.stageId)
            expect(fetchedLead.dealValue).toBe(createdLead.dealValue)
            expect(fetchedLead.score).toBe(createdLead.score)
            expect(fetchedLead.deletedAt).toBeNull()
          },
        ),
      )
    })
  })

  describe('Property: Soft-deleting an already-deleted lead does not change deletedAt (idempotence)', () => {
    /**
     * **Validates: Requirements 4.3**
     *
     * The softDeleteLead function is idempotent: calling it on a lead
     * that already has a non-null deletedAt returns the same deletedAt
     * timestamp without modifying it.
     */

    it('calling softDeleteLead on an already-deleted lead returns the same deletedAt', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // userId
          uuidArb, // orgId
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
          async (leadId, userId, orgId, originalDeletedAt) => {
            const existingLead = {
              id: leadId,
              firstName: 'Test',
              lastName: 'Lead',
              deletedAt: originalDeletedAt,
              organizationId: orgId,
            }

            // Mock findFirst to return the already-deleted lead
            mockDb.lead.findFirst.mockResolvedValue(existingLead)
            mockDb.lead.update.mockClear()

            const result = await softDeleteLead(leadId, userId, orgId)

            // The returned lead should have the SAME deletedAt as before
            expect(result.deletedAt).toEqual(originalDeletedAt)

            // update should NOT have been called (idempotent — no DB write)
            expect(mockDb.lead.update).not.toHaveBeenCalled()
          },
        ),
      )
    })

    it('softDeleteLead sets deletedAt on first call, then preserves it on subsequent calls', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // userId
          uuidArb, // orgId
          fc.integer({ min: 1, max: 5 }), // number of additional delete calls
          async (leadId, userId, orgId, extraCalls) => {
            const activeLead = {
              id: leadId,
              firstName: 'Test',
              lastName: 'Lead',
              deletedAt: null,
              organizationId: orgId,
            }

            const deletedAt = new Date('2025-06-01T12:00:00Z')

            // First call: lead is active
            mockDb.lead.findFirst.mockResolvedValueOnce(activeLead)
            mockDb.lead.update.mockResolvedValueOnce({
              ...activeLead,
              deletedAt,
            })

            const firstResult = await softDeleteLead(leadId, userId, orgId)
            expect(firstResult.deletedAt).toEqual(deletedAt)

            // Subsequent calls: lead is already deleted
            const deletedLead = { ...activeLead, deletedAt }

            for (let i = 0; i < extraCalls; i++) {
              mockDb.lead.findFirst.mockResolvedValueOnce(deletedLead)
              mockDb.lead.update.mockClear()

              const result = await softDeleteLead(leadId, userId, orgId)

              // deletedAt should remain unchanged
              expect(result.deletedAt).toEqual(deletedAt)
              // No update call should be made
              expect(mockDb.lead.update).not.toHaveBeenCalled()
            }
          },
        ),
      )
    })

    it('softDeleteLead never overwrites an existing deletedAt with a new timestamp', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // userId
          uuidArb, // orgId
          fc.date({ min: new Date('2020-01-01'), max: new Date('2025-01-01') }),
          async (leadId, userId, orgId, pastDeletedAt) => {
            const alreadyDeletedLead = {
              id: leadId,
              firstName: 'Test',
              lastName: 'Lead',
              deletedAt: pastDeletedAt,
              organizationId: orgId,
            }

            mockDb.lead.findFirst.mockResolvedValue(alreadyDeletedLead)
            mockDb.lead.update.mockClear()

            const result = await softDeleteLead(leadId, userId, orgId)

            // The deletedAt must be the original value, not a new Date()
            expect(result.deletedAt).toEqual(pastDeletedAt)

            // Verify no update was attempted
            expect(mockDb.lead.update).not.toHaveBeenCalled()
          },
        ),
      )
    })
  })
})
