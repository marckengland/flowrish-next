import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for activity timeline.
 *
 * These tests verify that:
 * 1. Activities returned by getActivitiesByLead are always sorted by createdAt descending
 * 2. After createActivity, the count of activities for that lead increases by 1
 * 3. After createActivity, the lead's lastActivityAt is updated to the current time
 *
 * **Validates: Requirements 5.1, 5.3, 5.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  lead: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  activity: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Lead', 'Activity'],
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { createActivity, getActivitiesByLead } from '@/server/services/activities'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate a random date within a reasonable range */
const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })

/** Generate a valid activity type */
const activityTypeArb = fc.constantFrom('CALL', 'MEETING', 'NOTE', 'EMAIL', 'FILE_ATTACHMENT')

/**
 * Generate an activity record as it would exist in the database.
 * Each activity has a unique createdAt timestamp.
 */
const activityRecordArb = fc.record({
  id: uuidArb,
  type: activityTypeArb,
  leadId: uuidArb,
  createdById: uuidArb,
  notes: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 })),
  createdAt: dateArb,
})

/**
 * Generate a list of activity records with distinct createdAt timestamps.
 */
const activityListArb = fc
  .array(activityRecordArb, { minLength: 0, maxLength: 20 })
  .map(activities => {
    // Ensure distinct createdAt values by offsetting each by index milliseconds
    return activities.map((a, i) => ({
      ...a,
      createdAt: new Date(a.createdAt.getTime() + i),
    }))
  })

/**
 * Generate valid activity creation input that passes Zod validation.
 * Generates type-appropriate fields (callDate for CALL, meetingDate for MEETING).
 */
const validActivityInputArb = fc.oneof(
  // NOTE type
  fc.record({
    type: fc.constant('NOTE' as const),
    leadId: uuidArb,
    notes: fc.oneof(fc.constant(undefined), fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\0') && !s.includes('..'))),
  }),
  // EMAIL type
  fc.record({
    type: fc.constant('EMAIL' as const),
    leadId: uuidArb,
    notes: fc.oneof(fc.constant(undefined), fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\0') && !s.includes('..'))),
  }),
  // FILE_ATTACHMENT type
  fc.record({
    type: fc.constant('FILE_ATTACHMENT' as const),
    leadId: uuidArb,
    notes: fc.oneof(fc.constant(undefined), fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\0') && !s.includes('..'))),
  }),
  // CALL type (requires callDate)
  fc.record({
    type: fc.constant('CALL' as const),
    leadId: uuidArb,
    callDate: dateArb.map(d => d.toISOString()),
    callDuration: fc.oneof(fc.constant(undefined), fc.nat({ max: 7200 })),
    notes: fc.oneof(fc.constant(undefined), fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\0') && !s.includes('..'))),
  }),
  // MEETING type (requires meetingDate)
  fc.record({
    type: fc.constant('MEETING' as const),
    leadId: uuidArb,
    meetingDate: dateArb.map(d => d.toISOString()),
    attendees: fc.oneof(fc.constant(undefined), fc.array(fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('\0') && !s.includes('..')), { minLength: 1, maxLength: 5 })),
    notes: fc.oneof(fc.constant(undefined), fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes('\0') && !s.includes('..'))),
  }),
)

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Activity Timeline - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Activity list is always sorted by createdAt descending', () => {
    /**
     * **Validates: Requirements 5.4**
     *
     * The getActivitiesByLead function always returns activities sorted
     * by createdAt in descending order (newest first). This property
     * verifies that regardless of the order activities are stored,
     * the returned list is always properly sorted.
     */

    it('getActivitiesByLead returns activities in descending createdAt order', async () => {
      await fc.assert(
        fc.asyncProperty(
          activityListArb,
          uuidArb, // leadId
          uuidArb, // orgId
          async (activities, leadId, orgId) => {
            const lead = { id: leadId, deletedAt: null }

            // Assign all activities to the same lead
            const leadActivities = activities.map(a => ({ ...a, leadId }))

            // Sort descending by createdAt (simulating Prisma orderBy: { createdAt: 'desc' })
            const sortedActivities = [...leadActivities].sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
            )

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.findMany.mockResolvedValue(sortedActivities)

            const result = await getActivitiesByLead(leadId, orgId)

            // Verify the result is sorted by createdAt descending
            for (let i = 0; i < result.length - 1; i++) {
              const current = new Date(result[i].createdAt).getTime()
              const next = new Date(result[i + 1].createdAt).getTime()
              expect(current).toBeGreaterThanOrEqual(next)
            }
          },
        ),
      )
    })

    it('getActivitiesByLead requests orderBy createdAt desc from Prisma', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // leadId
          uuidArb, // orgId
          async (leadId, orgId) => {
            const lead = { id: leadId, deletedAt: null }
            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.findMany.mockResolvedValue([])

            await getActivitiesByLead(leadId, orgId)

            // Verify the orderBy clause is always { createdAt: 'desc' }
            expect(mockDb.activity.findMany).toHaveBeenCalledWith(
              expect.objectContaining({
                orderBy: { createdAt: 'desc' },
              }),
            )
          },
        ),
      )
    })
  })

  describe('Property: Adding an activity increases activity count by exactly 1', () => {
    /**
     * **Validates: Requirements 5.1, 5.3**
     *
     * When createActivity is called successfully, the total number of
     * activities for that lead increases by exactly 1. This is a metamorphic
     * property: the count after creation = count before creation + 1.
     */

    it('createActivity increases the activity count for the lead by exactly 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          validActivityInputArb,
          uuidArb, // userId
          uuidArb, // orgId
          fc.array(activityRecordArb, { minLength: 0, maxLength: 10 }), // existing activities
          async (inputData, userId, orgId, existingActivities) => {
            const leadId = inputData.leadId
            const lead = { id: leadId, deletedAt: null }

            // Track activities in a mutable store
            const activityStore = [...existingActivities.map(a => ({ ...a, leadId }))]
            const countBefore = activityStore.length

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.create.mockImplementation(({ data }: any) => {
              const newActivity = {
                id: `activity-new-${Date.now()}`,
                ...data,
                createdAt: new Date(),
              }
              activityStore.push(newActivity)
              return Promise.resolve(newActivity)
            })
            mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

            await createActivity(inputData, userId, orgId)

            const countAfter = activityStore.length

            // Count increased by exactly 1
            expect(countAfter).toBe(countBefore + 1)
          },
        ),
      )
    })

    it('each createActivity call adds exactly one activity record', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(validActivityInputArb, { minLength: 1, maxLength: 5 }),
          uuidArb, // userId
          uuidArb, // orgId
          async (inputs, userId, orgId) => {
            const activityStore: any[] = []

            // Use the leadId from the first input for all activities
            const leadId = inputs[0].leadId
            const lead = { id: leadId, deletedAt: null }

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.create.mockImplementation(({ data }: any) => {
              const newActivity = {
                id: `activity-${activityStore.length}`,
                ...data,
                createdAt: new Date(),
              }
              activityStore.push(newActivity)
              return Promise.resolve(newActivity)
            })
            mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

            // Create N activities, all with the same leadId
            for (const input of inputs) {
              await createActivity({ ...input, leadId }, userId, orgId)
            }

            // Total activities should equal the number of inputs
            expect(activityStore.length).toBe(inputs.length)
          },
        ),
      )
    })
  })

  describe('Property: lastActivityAt equals the most recent activity createdAt', () => {
    /**
     * **Validates: Requirements 5.3**
     *
     * When an activity is created, the lead's lastActivityAt field is
     * updated to the current timestamp. This ensures the lead always
     * reflects when the most recent interaction occurred.
     */

    it('createActivity updates lead lastActivityAt to current time', async () => {
      await fc.assert(
        fc.asyncProperty(
          validActivityInputArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (inputData, userId, orgId) => {
            const leadId = inputData.leadId
            const lead = { id: leadId, deletedAt: null, lastActivityAt: null }

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.create.mockImplementation(({ data }: any) =>
              Promise.resolve({
                id: 'activity-new',
                ...data,
                createdAt: new Date(),
              }),
            )

            let updatedLastActivityAt: Date | null = null
            mockDb.lead.update.mockImplementation(({ data }: any) => {
              updatedLastActivityAt = data.lastActivityAt
              return Promise.resolve({ ...lead, lastActivityAt: data.lastActivityAt })
            })

            const timeBefore = new Date()
            await createActivity(inputData, userId, orgId)
            const timeAfter = new Date()

            // lastActivityAt should have been set
            expect(updatedLastActivityAt).not.toBeNull()
            expect(updatedLastActivityAt).toBeInstanceOf(Date)

            // lastActivityAt should be between timeBefore and timeAfter
            expect((updatedLastActivityAt as Date).getTime()).toBeGreaterThanOrEqual(timeBefore.getTime())
            expect((updatedLastActivityAt as Date).getTime()).toBeLessThanOrEqual(timeAfter.getTime())
          },
        ),
      )
    })

    it('lead.update is always called with lastActivityAt after activity creation', async () => {
      await fc.assert(
        fc.asyncProperty(
          validActivityInputArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (inputData, userId, orgId) => {
            const leadId = inputData.leadId
            const lead = { id: leadId, deletedAt: null }

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.create.mockImplementation(({ data }: any) =>
              Promise.resolve({ id: 'activity-new', ...data, createdAt: new Date() }),
            )
            mockDb.lead.update.mockResolvedValue({ ...lead, lastActivityAt: new Date() })

            await createActivity(inputData, userId, orgId)

            // Verify lead.update was called with the correct leadId and lastActivityAt
            expect(mockDb.lead.update).toHaveBeenCalledWith({
              where: { id: leadId },
              data: { lastActivityAt: expect.any(Date) },
            })
          },
        ),
      )
    })

    it('lastActivityAt is always updated to a recent timestamp, not a past date', async () => {
      await fc.assert(
        fc.asyncProperty(
          validActivityInputArb,
          uuidArb, // userId
          uuidArb, // orgId
          fc.date({ min: new Date('2020-01-01'), max: new Date('2023-01-01') }), // old lastActivityAt
          async (inputData, userId, orgId, oldLastActivityAt) => {
            const leadId = inputData.leadId
            const lead = { id: leadId, deletedAt: null, lastActivityAt: oldLastActivityAt }

            mockDb.lead.findFirst.mockResolvedValue(lead)
            mockDb.activity.create.mockImplementation(({ data }: any) =>
              Promise.resolve({ id: 'activity-new', ...data, createdAt: new Date() }),
            )

            let newLastActivityAt: Date | null = null
            mockDb.lead.update.mockImplementation(({ data }: any) => {
              newLastActivityAt = data.lastActivityAt
              return Promise.resolve({ ...lead, lastActivityAt: data.lastActivityAt })
            })

            await createActivity(inputData, userId, orgId)

            // The new lastActivityAt should be more recent than the old one
            expect(newLastActivityAt).not.toBeNull()
            expect((newLastActivityAt as Date).getTime()).toBeGreaterThan(oldLastActivityAt.getTime())
          },
        ),
      )
    })
  })
})
