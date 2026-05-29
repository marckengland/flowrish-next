import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for cadence step CRUD on the cadence service.
 *
 * Covers:
 * - addStep: respects ARCHIVED guard, auto-assigns stepOrder, maps
 *   subject/body for EMAIL and taskTitle/taskDescription for non-EMAIL,
 *   accepts the legacy `instructions` alias.
 * - updateStep: rejects on archived cadence, rejects when step is missing
 *   or belongs to another cadence, only writes provided fields.
 * - deleteStep: rejects on archived cadence, rejects when active or
 *   paused enrollments exist, renumbers remaining steps contiguously.
 *
 * Validates: Requirements 6.4, 6.10
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  cadence: {
    findFirst: vi.fn(),
  },
  cadenceStep: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  cadenceEnrollment: {
    count: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Cadence', 'CadenceEnrollment', 'CadenceStep'],
}))

const mockTransaction = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    $transaction: (cb: (tx: typeof mockDb) => Promise<unknown>) =>
      mockTransaction(cb),
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import {
  addStep,
  updateStep,
  deleteStep,
} from '@/server/services/cadences'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cadence Step Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const cadenceId = '770e8400-e29b-41d4-a716-446655440002'
  const stepId = '770e8400-e29b-41d4-a716-44665544000a'

  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation((cb) => cb(mockDb))
  })

  // ─── addStep ─────────────────────────────────────────────────────────────

  describe('addStep', () => {
    it('auto-assigns stepOrder = max + 1 and maps email fields', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [{ stepOrder: 3 }],
      })
      mockDb.cadenceStep.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: stepId, ...data }),
      )

      const result = await addStep(
        cadenceId,
        {
          actionType: 'EMAIL',
          stepOrder: 1, // ignored by the service
          delayHours: 24,
          subject: 'Hello {{FirstName}}',
          body: '<p>Body</p>',
        },
        orgId,
      )

      expect(result.stepOrder).toBe(4)
      expect(result.actionType).toBe('EMAIL')
      expect(result.emailSubject).toBe('Hello {{FirstName}}')
      expect(result.emailBody).toBe('<p>Body</p>')
      expect(result.taskTitle).toBeNull()
    })

    it('uses 1 as the first step order when the cadence has no steps yet', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [],
      })
      mockDb.cadenceStep.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: stepId, ...data }),
      )

      const result = await addStep(
        cadenceId,
        { actionType: 'EMAIL', stepOrder: 99, delayHours: 0 },
        orgId,
      )

      expect(result.stepOrder).toBe(1)
    })

    it('maps taskTitle / taskDescription for non-EMAIL steps', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [],
      })
      mockDb.cadenceStep.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: stepId, ...data }),
      )

      const result = await addStep(
        cadenceId,
        {
          actionType: 'CALL',
          stepOrder: 1,
          delayHours: 12,
          taskTitle: 'Discovery call',
          taskDescription: 'Walk through pricing',
        },
        orgId,
      )

      expect(result.taskTitle).toBe('Discovery call')
      expect(result.taskDescription).toBe('Walk through pricing')
      expect(result.emailSubject).toBeNull()
      expect(result.emailBody).toBeNull()
    })

    it('accepts the legacy `instructions` alias as taskTitle', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [],
      })
      mockDb.cadenceStep.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: stepId, ...data }),
      )

      const result = await addStep(
        cadenceId,
        {
          actionType: 'MANUAL_TASK',
          stepOrder: 1,
          delayHours: 0,
          instructions: 'Send LinkedIn DM',
        },
        orgId,
      )

      expect(result.taskTitle).toBe('Send LinkedIn DM')
      expect(result.taskDescription).toBeNull()
    })

    it('rejects when the cadence is ARCHIVED', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ARCHIVED',
        steps: [],
      })

      await expect(
        addStep(
          cadenceId,
          { actionType: 'EMAIL', stepOrder: 1, delayHours: 0 },
          orgId,
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('rejects when the cadence does not exist', async () => {
      mockDb.cadence.findFirst.mockResolvedValue(null)

      await expect(
        addStep(
          cadenceId,
          { actionType: 'EMAIL', stepOrder: 1, delayHours: 0 },
          orgId,
        ),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })
  })

  // ─── updateStep ──────────────────────────────────────────────────────────

  describe('updateStep', () => {
    it('only writes the fields provided in the patch', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
      })
      mockDb.cadenceStep.findFirst.mockResolvedValue({
        id: stepId,
        cadenceId,
      })
      mockDb.cadenceStep.update.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, cadenceId, ...data }),
      )

      const result = await updateStep(
        cadenceId,
        stepId,
        { delayHours: 48 },
        orgId,
      )

      expect(mockDb.cadenceStep.update).toHaveBeenCalledWith({
        where: { id: stepId },
        data: { delayHours: 48 },
      })
      expect(result.delayHours).toBe(48)
    })

    it('maps subject/body to emailSubject/emailBody', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
      })
      mockDb.cadenceStep.findFirst.mockResolvedValue({
        id: stepId,
        cadenceId,
      })
      mockDb.cadenceStep.update.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, cadenceId, ...data }),
      )

      await updateStep(
        cadenceId,
        stepId,
        { subject: 'New subject', body: '<p>new</p>' },
        orgId,
      )

      expect(mockDb.cadenceStep.update).toHaveBeenCalledWith({
        where: { id: stepId },
        data: { emailSubject: 'New subject', emailBody: '<p>new</p>' },
      })
    })

    it('rejects on ARCHIVED cadence', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ARCHIVED',
      })

      await expect(
        updateStep(cadenceId, stepId, { delayHours: 48 }, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })

      // Step lookup must be skipped when the cadence guard fails.
      expect(mockDb.cadenceStep.findFirst).not.toHaveBeenCalled()
    })

    it('throws NOT_FOUND when the step does not belong to the cadence', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
      })
      mockDb.cadenceStep.findFirst.mockResolvedValue(null)

      await expect(
        updateStep(cadenceId, stepId, { delayHours: 48 }, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('rejects an empty patch via the validator', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
      })
      mockDb.cadenceStep.findFirst.mockResolvedValue({
        id: stepId,
        cadenceId,
      })

      await expect(
        updateStep(cadenceId, stepId, {}, orgId),
      ).rejects.toThrow(/At least one field/)
    })
  })

  // ─── deleteStep ──────────────────────────────────────────────────────────

  describe('deleteStep', () => {
    it('renumbers remaining steps contiguously starting at 1', async () => {
      const stepA = { id: 'a', cadenceId, stepOrder: 1 }
      const stepB = { id: 'b', cadenceId, stepOrder: 2 }
      const stepC = { id: 'c', cadenceId, stepOrder: 3 }

      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [stepA, stepB, stepC],
      })
      mockDb.cadenceEnrollment.count.mockResolvedValue(0)
      mockDb.cadenceStep.delete.mockResolvedValue(stepB)
      mockDb.cadenceStep.update.mockImplementation(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data }),
      )
      // After renumber: A stays at 1, C moves from 3 → 2.
      mockDb.cadenceStep.findMany.mockResolvedValue([
        { ...stepA, stepOrder: 1 },
        { ...stepC, stepOrder: 2 },
      ])

      const result = await deleteStep(cadenceId, 'b', orgId)

      expect(result.deletedStepId).toBe('b')
      expect(result.steps.map((s) => s.stepOrder)).toEqual([1, 2])
      expect(mockDb.cadenceStep.delete).toHaveBeenCalledWith({
        where: { id: 'b' },
      })
      // Two-pass renumber: 2 negative writes + 2 positive writes.
      expect(mockDb.cadenceStep.update).toHaveBeenCalledTimes(4)
    })

    it('returns an empty step list when the last step is removed', async () => {
      const onlyStep = { id: stepId, cadenceId, stepOrder: 1 }
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [onlyStep],
      })
      mockDb.cadenceEnrollment.count.mockResolvedValue(0)
      mockDb.cadenceStep.delete.mockResolvedValue(onlyStep)

      const result = await deleteStep(cadenceId, stepId, orgId)

      expect(result.steps).toEqual([])
      // No renumber needed.
      expect(mockDb.cadenceStep.update).not.toHaveBeenCalled()
      // No follow-up findMany call when nothing remains.
      expect(mockDb.cadenceStep.findMany).not.toHaveBeenCalled()
    })

    it('rejects on ARCHIVED cadence', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ARCHIVED',
        steps: [{ id: stepId, cadenceId, stepOrder: 1 }],
      })

      await expect(
        deleteStep(cadenceId, stepId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
      expect(mockDb.cadenceStep.delete).not.toHaveBeenCalled()
    })

    it('throws NOT_FOUND when the step does not belong to the cadence', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
        steps: [{ id: 'someone-else', cadenceId, stepOrder: 1 }],
      })

      await expect(
        deleteStep(cadenceId, stepId, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('rejects when ACTIVE or PAUSED enrollments exist', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ACTIVE',
        steps: [{ id: stepId, cadenceId, stepOrder: 1 }],
      })
      mockDb.cadenceEnrollment.count.mockResolvedValue(2)

      await expect(
        deleteStep(cadenceId, stepId, orgId),
      ).rejects.toMatchObject({
        code: 'ACTIVE_ENROLLMENTS',
        statusCode: 409,
      })
      expect(mockDb.cadenceStep.delete).not.toHaveBeenCalled()
    })
  })
})
