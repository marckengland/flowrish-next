import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the Inngest cadence step execution function.
 *
 * Tests cover:
 * - Skipping execution when enrollment is not ACTIVE
 * - Executing step action and creating execution log
 * - Advancing enrollment to next step
 * - Completing enrollment when no next step exists
 * - Scheduling next step with delay
 *
 * **Validates: Requirements 6.7, 6.8, 14.1, 14.6**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  cadenceEnrollment: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  cadenceStep: {
    findFirst: vi.fn(),
  },
  stepExecutionLog: {
    create: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['CadenceEnrollment', 'CadenceStep', 'StepExecutionLog'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

const mockCompleteEnrollment = vi.fn()
vi.mock('@/server/services/cadences', () => ({
  completeEnrollment: (...args: unknown[]) => mockCompleteEnrollment(...args),
}))

const mockInngestSend = vi.fn()
vi.mock('../client', () => ({
  inngest: {
    createFunction: vi.fn((config, handler) => {
      // Store the handler for testing
      return { config, trigger: config.triggers?.[0], handler }
    }),
    send: (...args: unknown[]) => mockInngestSend(...args),
  },
}))

// Import after mocks
import { cadenceStepFunction } from '../cadence-step'

// ─── Test Helpers ────────────────────────────────────────────────────────────

const orgId = '550e8400-e29b-41d4-a716-446655440000'
const enrollmentId = '990e8400-e29b-41d4-a716-446655440004'
const stepId = 'aaa00000-0000-0000-0000-000000000001'
const cadenceId = '770e8400-e29b-41d4-a716-446655440002'
const leadId = '880e8400-e29b-41d4-a716-446655440003'

function createMockEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      enrollmentId,
      stepId,
      cadenceId,
      leadId,
      organizationId: orgId,
      ...overrides,
    },
  }
}

function createMockStep() {
  const stepFn = {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    sleep: vi.fn(),
  }
  return stepFn
}

// Get the handler from the function definition
const handler = (cadenceStepFunction as any).handler

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cadence Step Execution Function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('function configuration', () => {
    it('should be configured with id "cadence-step-execution"', () => {
      expect((cadenceStepFunction as any).config.id).toBe('cadence-step-execution')
    })

    it('should be configured with retries: 3', () => {
      expect((cadenceStepFunction as any).config.retries).toBe(3)
    })

    it('should listen to "cadence/step.execute" event', () => {
      expect((cadenceStepFunction as any).trigger.event).toBe('cadence/step.execute')
    })
  })

  describe('enrollment verification', () => {
    it('should return skipped when enrollment is not found', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue(null)

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ skipped: true, reason: 'enrollment_not_active' })
    })

    it('should return skipped when enrollment status is PAUSED', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'PAUSED',
        currentStepOrder: 1,
      })

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ skipped: true, reason: 'enrollment_not_active' })
    })

    it('should return skipped when enrollment status is COMPLETED', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'COMPLETED',
        currentStepOrder: 3,
      })

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ skipped: true, reason: 'enrollment_not_active' })
    })

    it('should return skipped when enrollment status is EXITED', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
        currentStepOrder: 2,
      })

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(result).toEqual({ skipped: true, reason: 'enrollment_not_active' })
    })
  })

  describe('step execution', () => {
    it('should execute EMAIL action and create execution log', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 1,
      })
      mockDb.cadenceStep.findFirst
        .mockResolvedValueOnce({
          id: stepId,
          actionType: 'EMAIL',
          emailSubject: 'Hello',
          emailBody: 'World',
          taskTitle: null,
          taskDescription: null,
        })
        .mockResolvedValueOnce(null) // no next step
      mockDb.stepExecutionLog.create.mockResolvedValue({ id: 'log-1' })
      mockDb.cadenceEnrollment.update.mockResolvedValue({})
      mockCompleteEnrollment.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(mockDb.stepExecutionLog.create).toHaveBeenCalledWith({
        data: {
          enrollmentId,
          stepId,
          actionType: 'EMAIL',
          outcome: 'SUCCESS',
          attemptCount: 1,
        },
      })
      expect(result).toEqual({ executed: true, completed: true })
    })

    it('should execute CALL action and create execution log', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 1,
      })
      mockDb.cadenceStep.findFirst
        .mockResolvedValueOnce({
          id: stepId,
          actionType: 'CALL',
          emailSubject: null,
          emailBody: null,
          taskTitle: null,
          taskDescription: null,
        })
        .mockResolvedValueOnce(null) // no next step
      mockDb.stepExecutionLog.create.mockResolvedValue({ id: 'log-1' })
      mockDb.cadenceEnrollment.update.mockResolvedValue({})
      mockCompleteEnrollment.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(mockDb.stepExecutionLog.create).toHaveBeenCalledWith({
        data: {
          enrollmentId,
          stepId,
          actionType: 'CALL',
          outcome: 'SUCCESS',
          attemptCount: 1,
        },
      })
      expect(result).toEqual({ executed: true, completed: true })
    })

    it('should throw error when step is not found', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 1,
      })
      mockDb.cadenceStep.findFirst.mockResolvedValueOnce(null)

      await expect(
        handler({ event: createMockEvent(), step: mockStep }),
      ).rejects.toThrow(`CadenceStep ${stepId} not found`)
    })
  })

  describe('enrollment advancement', () => {
    it('should increment currentStepOrder after execution', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 2,
      })
      mockDb.cadenceStep.findFirst
        .mockResolvedValueOnce({
          id: stepId,
          actionType: 'LINKEDIN',
          emailSubject: null,
          emailBody: null,
          taskTitle: null,
          taskDescription: null,
        })
        .mockResolvedValueOnce(null) // no next step
      mockDb.stepExecutionLog.create.mockResolvedValue({ id: 'log-1' })
      mockDb.cadenceEnrollment.update.mockResolvedValue({})
      mockCompleteEnrollment.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      expect(mockDb.cadenceEnrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { currentStepOrder: 3 },
      })
    })
  })

  describe('next step scheduling', () => {
    it('should schedule next step when one exists', async () => {
      const nextStepId = 'bbb00000-0000-0000-0000-000000000002'
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 1,
      })
      mockDb.cadenceStep.findFirst
        .mockResolvedValueOnce({
          id: stepId,
          actionType: 'EMAIL',
          emailSubject: 'Hi',
          emailBody: 'Body',
          taskTitle: null,
          taskDescription: null,
        })
        .mockResolvedValueOnce({
          id: nextStepId,
          delayHours: 24,
        })
      mockDb.stepExecutionLog.create.mockResolvedValue({ id: 'log-1' })
      mockDb.cadenceEnrollment.update.mockResolvedValue({})
      mockInngestSend.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(mockStep.sleep).toHaveBeenCalledWith('wait-for-delay', '24h')
      expect(mockInngestSend).toHaveBeenCalledWith({
        name: 'cadence/step.execute',
        data: {
          enrollmentId,
          stepId: nextStepId,
          cadenceId,
          leadId,
          organizationId: orgId,
        },
      })
      expect(result).toEqual({
        executed: true,
        nextStepScheduled: true,
        nextStepId,
      })
    })

    it('should not sleep when next step has zero delay', async () => {
      const nextStepId = 'bbb00000-0000-0000-0000-000000000002'
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 1,
      })
      mockDb.cadenceStep.findFirst
        .mockResolvedValueOnce({
          id: stepId,
          actionType: 'MANUAL_TASK',
          emailSubject: null,
          emailBody: null,
          taskTitle: 'Follow up',
          taskDescription: 'Call the lead',
        })
        .mockResolvedValueOnce({
          id: nextStepId,
          delayHours: 0,
        })
      mockDb.stepExecutionLog.create.mockResolvedValue({ id: 'log-1' })
      mockDb.cadenceEnrollment.update.mockResolvedValue({})
      mockInngestSend.mockResolvedValue({})

      await handler({ event: createMockEvent(), step: mockStep })

      expect(mockStep.sleep).not.toHaveBeenCalled()
      expect(mockInngestSend).toHaveBeenCalled()
    })
  })

  describe('enrollment completion', () => {
    it('should complete enrollment when no next step exists', async () => {
      const mockStep = createMockStep()
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
        currentStepOrder: 3,
      })
      mockDb.cadenceStep.findFirst
        .mockResolvedValueOnce({
          id: stepId,
          actionType: 'EMAIL',
          emailSubject: 'Final',
          emailBody: 'Last step',
          taskTitle: null,
          taskDescription: null,
        })
        .mockResolvedValueOnce(null) // no next step
      mockDb.stepExecutionLog.create.mockResolvedValue({ id: 'log-1' })
      mockDb.cadenceEnrollment.update.mockResolvedValue({})
      mockCompleteEnrollment.mockResolvedValue({})

      const result = await handler({ event: createMockEvent(), step: mockStep })

      expect(mockCompleteEnrollment).toHaveBeenCalledWith(enrollmentId, orgId)
      expect(result).toEqual({ executed: true, completed: true })
    })
  })
})
