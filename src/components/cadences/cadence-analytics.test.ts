import { describe, expect, it } from 'vitest'

import { computePerStepMetrics } from './cadence-analytics'
import type { CadenceStep, EnrollmentListItem } from '@/hooks/use-cadences'

function makeStep(order: number, overrides: Partial<CadenceStep> = {}): CadenceStep {
  return {
    id: `step-${order}`,
    cadenceId: 'cad-1',
    stepOrder: order,
    actionType: 'EMAIL',
    delayHours: 0,
    emailSubject: null,
    emailBody: null,
    taskTitle: null,
    taskDescription: null,
    startNewThread: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeEnrollment(
  overrides: Partial<EnrollmentListItem>,
): EnrollmentListItem {
  return {
    id: `en-${Math.random().toString(36).slice(2, 8)}`,
    cadenceId: 'cad-1',
    leadId: `lead-${Math.random().toString(36).slice(2, 8)}`,
    enrolledById: 'user-1',
    status: 'ACTIVE',
    currentStepOrder: 1,
    exitReason: null,
    enrolledAt: '2024-01-01T00:00:00.000Z',
    completedAt: null,
    updatedAt: '2024-01-01T00:00:00.000Z',
    lead: null,
    ...overrides,
  }
}

describe('computePerStepMetrics', () => {
  const steps = [makeStep(1), makeStep(2), makeStep(3)]

  it('returns zero counts when no enrollments exist', () => {
    const result = computePerStepMetrics(steps, [])
    expect(result).toHaveLength(3)
    for (const row of result) {
      expect(row.reached).toBe(0)
      expect(row.completed).toBe(0)
      expect(row.exited).toBe(0)
    }
  })

  it('counts an ACTIVE lead at step 2 as reached on steps 1 and 2', () => {
    const result = computePerStepMetrics(steps, [
      makeEnrollment({ currentStepOrder: 2, status: 'ACTIVE' }),
    ])
    expect(result[0]).toMatchObject({ reached: 1, completed: 1, exited: 0 })
    expect(result[1]).toMatchObject({ reached: 1, completed: 0, exited: 0 })
    expect(result[2]).toMatchObject({ reached: 0, completed: 0, exited: 0 })
  })

  it('counts a COMPLETED enrollment as reached & completed on every step', () => {
    const result = computePerStepMetrics(steps, [
      makeEnrollment({ currentStepOrder: 3, status: 'COMPLETED' }),
    ])
    for (const row of result) {
      expect(row.reached).toBe(1)
      expect(row.completed).toBe(1)
    }
  })

  it('records an EXITED enrollment against the step it exited on', () => {
    const result = computePerStepMetrics(steps, [
      makeEnrollment({ currentStepOrder: 2, status: 'EXITED' }),
    ])
    expect(result[0]).toMatchObject({ reached: 1, completed: 1, exited: 0 })
    expect(result[1]).toMatchObject({ reached: 1, completed: 0, exited: 1 })
    expect(result[2]).toMatchObject({ reached: 0, completed: 0, exited: 0 })
  })

  it('sorts steps by stepOrder regardless of input order', () => {
    const shuffled = [makeStep(3), makeStep(1), makeStep(2)]
    const result = computePerStepMetrics(shuffled, [])
    expect(result.map((r) => r.stepOrder)).toEqual([1, 2, 3])
  })
})
