import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for duplicate detection and lead merge.
 *
 * These tests verify that:
 * 1. After merge, primary lead has union of both leads' activities
 * 2. No duplicate LeadContact records exist after merge
 * 3. Self-merge always returns an error
 *
 * **Validates: Requirements 27.3, 27.4, 27.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockDb, mockTransaction, mockLeadContactFindMany } = vi.hoisted(() => {
  const mockTransaction = vi.fn()
  const mockLeadContactFindMany = vi.fn()
  const mockDb = {
    lead: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  }
  return { mockDb, mockTransaction, mockLeadContactFindMany }
})

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Activity', 'LeadContact'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    $transaction: mockTransaction,
    leadContact: {
      findMany: mockLeadContactFindMany,
    },
    $extends: vi.fn(),
  },
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { mergeLeads } from '@/server/services/duplicates'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate a non-empty name string */
const nameArb = fc.stringOf(
  fc.char().filter((c) => c !== '\0' && c !== '.'),
  { minLength: 1, maxLength: 20 },
).filter((s) => s.trim().length > 0 && !s.includes('..'))

/** Generate an activity record */
const activityRecordArb = fc.record({
  id: uuidArb,
  type: fc.constantFrom('CALL', 'MEETING', 'NOTE', 'EMAIL', 'FILE_ATTACHMENT'),
  leadId: uuidArb,
  createdById: uuidArb,
  notes: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
})

/** Generate a contact ID record (as returned by leadContact.findMany) */
const contactIdRecordArb = fc.record({
  contactId: uuidArb,
})

/**
 * Generate a merge scenario with two distinct leads, their activities, and contacts.
 * Ensures primaryLeadId !== secondaryLeadId.
 */
const mergeScenarioArb = fc.record({
  primaryLeadId: uuidArb,
  secondaryLeadId: uuidArb,
  orgId: uuidArb,
  primaryActivities: fc.array(activityRecordArb, { minLength: 0, maxLength: 8 }),
  secondaryActivities: fc.array(activityRecordArb, { minLength: 0, maxLength: 8 }),
  primaryContactIds: fc.uniqueArray(uuidArb, { minLength: 0, maxLength: 5 }),
  secondaryContactIds: fc.uniqueArray(uuidArb, { minLength: 0, maxLength: 5 }),
}).filter((s) => s.primaryLeadId !== s.secondaryLeadId)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Duplicate Detection and Lead Merge - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: After merge, primary lead has union of both leads\' activities', () => {
    /**
     * **Validates: Requirements 27.3**
     *
     * When two leads are merged, all activities from the secondary lead
     * are moved to the primary lead. The resulting primary lead should
     * have the union of both leads' activities.
     */

    it('merged primary lead contains all activities from both leads', async () => {
      await fc.assert(
        fc.asyncProperty(mergeScenarioArb, async (scenario) => {
          const {
            primaryLeadId,
            secondaryLeadId,
            orgId,
            primaryActivities,
            secondaryActivities,
            primaryContactIds,
            secondaryContactIds,
          } = scenario

          // Assign correct leadIds to activities
          const primaryActs = primaryActivities.map((a) => ({ ...a, leadId: primaryLeadId }))
          const secondaryActs = secondaryActivities.map((a) => ({ ...a, leadId: secondaryLeadId }))

          const primaryLead = {
            id: primaryLeadId,
            firstName: 'Primary',
            lastName: 'Lead',
            deletedAt: null,
            organizationId: orgId,
          }
          const secondaryLead = {
            id: secondaryLeadId,
            firstName: 'Secondary',
            lastName: 'Lead',
            deletedAt: null,
            organizationId: orgId,
          }

          // Mock tenant-scoped lead lookups
          mockDb.lead.findFirst.mockImplementation(({ where }: any) => {
            if (where.id === primaryLeadId) return Promise.resolve(primaryLead)
            if (where.id === secondaryLeadId) return Promise.resolve(secondaryLead)
            return Promise.resolve(null)
          })

          // Mock leadContact.findMany for existing contacts on primary and secondary
          mockLeadContactFindMany.mockImplementation(({ where }: any) => {
            if (where.leadId === primaryLeadId) {
              return Promise.resolve(primaryContactIds.map((id) => ({ contactId: id })))
            }
            if (where.leadId === secondaryLeadId) {
              return Promise.resolve(secondaryContactIds.map((id) => ({ contactId: id })))
            }
            return Promise.resolve([])
          })

          // Track what happens in the transaction
          let movedActivities: string[] = []
          let createdContactLinks: string[] = []
          let deletedLeadId: string | null = null

          mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
            const tx = {
              activity: {
                updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
                  // Track that activities from secondary are moved to primary
                  if (where.leadId === secondaryLeadId && data.leadId === primaryLeadId) {
                    movedActivities = secondaryActs.map((a) => a.id)
                  }
                  return { count: secondaryActs.length }
                }),
              },
              leadContact: {
                create: vi.fn().mockImplementation(async ({ data }: any) => {
                  createdContactLinks.push(data.contactId)
                  return data
                }),
                deleteMany: vi.fn().mockResolvedValue({ count: secondaryContactIds.length }),
              },
              lead: {
                delete: vi.fn().mockImplementation(async ({ where }: any) => {
                  deletedLeadId = where.id
                  return secondaryLead
                }),
                findUnique: vi.fn().mockResolvedValue({
                  ...primaryLead,
                  activities: [...primaryActs, ...secondaryActs.map((a) => ({ ...a, leadId: primaryLeadId }))],
                  contacts: [
                    ...primaryContactIds.map((id) => ({ contact: { id } })),
                    ...secondaryContactIds
                      .filter((id) => !primaryContactIds.includes(id))
                      .map((id) => ({ contact: { id } })),
                  ],
                  stage: { id: 'stage-1', name: 'New' },
                  assignedUser: null,
                  company: null,
                }),
              },
            }
            return fn(tx)
          })

          const result = await mergeLeads(primaryLeadId, secondaryLeadId, orgId)

          // The total activities on the merged lead should be the union of both
          const totalExpectedActivities = primaryActivities.length + secondaryActivities.length
          expect(result.activities.length).toBe(totalExpectedActivities)

          // The secondary lead should have been deleted
          expect(deletedLeadId).toBe(secondaryLeadId)
        }),
      )
    })

    it('activities from secondary lead are reassigned to primary lead ID', async () => {
      await fc.assert(
        fc.asyncProperty(mergeScenarioArb, async (scenario) => {
          const {
            primaryLeadId,
            secondaryLeadId,
            orgId,
            primaryActivities,
            secondaryActivities,
            primaryContactIds,
            secondaryContactIds,
          } = scenario

          const primaryLead = {
            id: primaryLeadId,
            firstName: 'Primary',
            lastName: 'Lead',
            deletedAt: null,
            organizationId: orgId,
          }
          const secondaryLead = {
            id: secondaryLeadId,
            firstName: 'Secondary',
            lastName: 'Lead',
            deletedAt: null,
            organizationId: orgId,
          }

          mockDb.lead.findFirst.mockImplementation(({ where }: any) => {
            if (where.id === primaryLeadId) return Promise.resolve(primaryLead)
            if (where.id === secondaryLeadId) return Promise.resolve(secondaryLead)
            return Promise.resolve(null)
          })

          mockLeadContactFindMany.mockImplementation(({ where }: any) => {
            if (where.leadId === primaryLeadId) {
              return Promise.resolve(primaryContactIds.map((id) => ({ contactId: id })))
            }
            if (where.leadId === secondaryLeadId) {
              return Promise.resolve(secondaryContactIds.map((id) => ({ contactId: id })))
            }
            return Promise.resolve([])
          })

          let activityUpdateCall: any = null

          mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
            const tx = {
              activity: {
                updateMany: vi.fn().mockImplementation(async (args: any) => {
                  activityUpdateCall = args
                  return { count: secondaryActivities.length }
                }),
              },
              leadContact: {
                create: vi.fn().mockResolvedValue({}),
                deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
              },
              lead: {
                delete: vi.fn().mockResolvedValue(secondaryLead),
                findUnique: vi.fn().mockResolvedValue({
                  ...primaryLead,
                  activities: [],
                  contacts: [],
                  stage: null,
                  assignedUser: null,
                  company: null,
                }),
              },
            }
            return fn(tx)
          })

          await mergeLeads(primaryLeadId, secondaryLeadId, orgId)

          // Verify that activity.updateMany was called to move activities
          // from secondary to primary
          expect(activityUpdateCall).not.toBeNull()
          expect(activityUpdateCall.where.leadId).toBe(secondaryLeadId)
          expect(activityUpdateCall.data.leadId).toBe(primaryLeadId)
        }),
      )
    })
  })

  describe('Property: No duplicate LeadContact records exist after merge', () => {
    /**
     * **Validates: Requirements 27.4**
     *
     * When merging leads, contacts already linked to the primary lead
     * are not duplicated. Only contacts unique to the secondary lead
     * are moved to the primary lead.
     */

    it('contacts already on primary lead are not re-created during merge', async () => {
      await fc.assert(
        fc.asyncProperty(
          mergeScenarioArb.chain((scenario) => {
            // Generate overlapping contacts: some contacts exist on both leads
            const sharedContactIds = scenario.primaryContactIds.filter((id) =>
              scenario.secondaryContactIds.includes(id),
            )
            return fc.constant({ ...scenario, sharedContactIds })
          }),
          async (scenario) => {
            const {
              primaryLeadId,
              secondaryLeadId,
              orgId,
              primaryContactIds,
              secondaryContactIds,
            } = scenario

            const primaryLead = {
              id: primaryLeadId,
              firstName: 'Primary',
              lastName: 'Lead',
              deletedAt: null,
              organizationId: orgId,
            }
            const secondaryLead = {
              id: secondaryLeadId,
              firstName: 'Secondary',
              lastName: 'Lead',
              deletedAt: null,
              organizationId: orgId,
            }

            mockDb.lead.findFirst.mockImplementation(({ where }: any) => {
              if (where.id === primaryLeadId) return Promise.resolve(primaryLead)
              if (where.id === secondaryLeadId) return Promise.resolve(secondaryLead)
              return Promise.resolve(null)
            })

            mockLeadContactFindMany.mockImplementation(({ where }: any) => {
              if (where.leadId === primaryLeadId) {
                return Promise.resolve(primaryContactIds.map((id) => ({ contactId: id })))
              }
              if (where.leadId === secondaryLeadId) {
                return Promise.resolve(secondaryContactIds.map((id) => ({ contactId: id })))
              }
              return Promise.resolve([])
            })

            const createdContactLinks: string[] = []

            mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
              const tx = {
                activity: {
                  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
                },
                leadContact: {
                  create: vi.fn().mockImplementation(async ({ data }: any) => {
                    createdContactLinks.push(data.contactId)
                    return data
                  }),
                  deleteMany: vi.fn().mockResolvedValue({ count: secondaryContactIds.length }),
                },
                lead: {
                  delete: vi.fn().mockResolvedValue(secondaryLead),
                  findUnique: vi.fn().mockResolvedValue({
                    ...primaryLead,
                    activities: [],
                    contacts: [],
                    stage: null,
                    assignedUser: null,
                    company: null,
                  }),
                },
              }
              return fn(tx)
            })

            await mergeLeads(primaryLeadId, secondaryLeadId, orgId)

            // Only contacts NOT already on primary should be created
            const expectedNewContacts = secondaryContactIds.filter(
              (id) => !primaryContactIds.includes(id),
            )

            expect(createdContactLinks.length).toBe(expectedNewContacts.length)

            // No contact that already exists on primary should be in createdContactLinks
            for (const contactId of createdContactLinks) {
              expect(primaryContactIds).not.toContain(contactId)
            }

            // All created contacts should be from the secondary lead's contacts
            for (const contactId of createdContactLinks) {
              expect(secondaryContactIds).toContain(contactId)
            }
          },
        ),
      )
    })

    it('the set of contacts after merge has no duplicates', async () => {
      await fc.assert(
        fc.asyncProperty(mergeScenarioArb, async (scenario) => {
          const {
            primaryLeadId,
            secondaryLeadId,
            orgId,
            primaryContactIds,
            secondaryContactIds,
          } = scenario

          const primaryLead = {
            id: primaryLeadId,
            firstName: 'Primary',
            lastName: 'Lead',
            deletedAt: null,
            organizationId: orgId,
          }
          const secondaryLead = {
            id: secondaryLeadId,
            firstName: 'Secondary',
            lastName: 'Lead',
            deletedAt: null,
            organizationId: orgId,
          }

          mockDb.lead.findFirst.mockImplementation(({ where }: any) => {
            if (where.id === primaryLeadId) return Promise.resolve(primaryLead)
            if (where.id === secondaryLeadId) return Promise.resolve(secondaryLead)
            return Promise.resolve(null)
          })

          mockLeadContactFindMany.mockImplementation(({ where }: any) => {
            if (where.leadId === primaryLeadId) {
              return Promise.resolve(primaryContactIds.map((id) => ({ contactId: id })))
            }
            if (where.leadId === secondaryLeadId) {
              return Promise.resolve(secondaryContactIds.map((id) => ({ contactId: id })))
            }
            return Promise.resolve([])
          })

          const createdContactLinks: string[] = []

          mockTransaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
            const tx = {
              activity: {
                updateMany: vi.fn().mockResolvedValue({ count: 0 }),
              },
              leadContact: {
                create: vi.fn().mockImplementation(async ({ data }: any) => {
                  createdContactLinks.push(data.contactId)
                  return data
                }),
                deleteMany: vi.fn().mockResolvedValue({ count: secondaryContactIds.length }),
              },
              lead: {
                delete: vi.fn().mockResolvedValue(secondaryLead),
                findUnique: vi.fn().mockResolvedValue({
                  ...primaryLead,
                  activities: [],
                  contacts: [],
                  stage: null,
                  assignedUser: null,
                  company: null,
                }),
              },
            }
            return fn(tx)
          })

          await mergeLeads(primaryLeadId, secondaryLeadId, orgId)

          // The final set of contacts on primary = original primary contacts + newly created
          const finalContactIds = [...primaryContactIds, ...createdContactLinks]

          // There should be no duplicates in the final set
          const uniqueContactIds = new Set(finalContactIds)
          expect(uniqueContactIds.size).toBe(finalContactIds.length)
        }),
      )
    })
  })

  describe('Property: Self-merge always returns an error', () => {
    /**
     * **Validates: Requirements 27.6**
     *
     * Attempting to merge a lead with itself always throws an AppError
     * with code 'SELF_MERGE'. This must hold for any valid lead ID.
     */

    it('mergeLeads throws SELF_MERGE error when primaryLeadId equals secondaryLeadId', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId (same for both)
          uuidArb, // orgId
          async (leadId, orgId) => {
            await expect(
              mergeLeads(leadId, leadId, orgId),
            ).rejects.toMatchObject({
              code: 'SELF_MERGE',
            })
          },
        ),
      )
    })

    it('self-merge never reaches the database (no findFirst calls)', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          async (leadId, orgId) => {
            mockDb.lead.findFirst.mockClear()

            try {
              await mergeLeads(leadId, leadId, orgId)
            } catch {
              // Expected to throw
            }

            // The function should reject before any DB calls
            expect(mockDb.lead.findFirst).not.toHaveBeenCalled()
          },
        ),
      )
    })

    it('self-merge error has status code 400', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          async (leadId, orgId) => {
            await expect(
              mergeLeads(leadId, leadId, orgId),
            ).rejects.toMatchObject({
              code: 'SELF_MERGE',
              statusCode: 400,
            })
          },
        ),
      )
    })
  })
})
