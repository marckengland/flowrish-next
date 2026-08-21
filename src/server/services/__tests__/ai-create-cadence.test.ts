import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the AI assistant's `create_cadence` action — both the
 * parse/sanitize path (extractActionBlock) and the executor
 * (executeChatAction). The executor reuses the real cadence services,
 * which are mocked here so we assert wiring without a DB.
 */

// ─── Mocks (names must start with `mock` for vitest hoisting) ────────────────

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => ({})),
  TENANT_SCOPED_MODELS: [],
}))
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: vi.fn() }))
vi.mock('@/lib/env', () => ({
  env: new Proxy({} as Record<string, string>, {
    get: (_t, p: string) => `mock-${p}`,
  }),
}))

const mockCreateCadence = vi.fn()
const mockAddStep = vi.fn()
vi.mock('@/server/services/cadences', () => ({
  createCadence: mockCreateCadence,
  addStep: mockAddStep,
}))

import { extractActionBlock, executeChatAction } from '@/server/services/ai'

function actionText(payload: unknown): string {
  return `Here is your cadence.\n[ACTION]${JSON.stringify(payload)}[/ACTION]`
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('extractActionBlock — create_cadence', () => {
  it('parses a valid create_cadence block into a structured action', () => {
    const { message, action } = extractActionBlock(
      actionText({
        type: 'create_cadence',
        description: 'Create SMB Outbound',
        params: {
          name: 'SMB Outbound',
          steps: [
            { actionType: 'EMAIL', delayHours: 0, subject: 'Hi', body: 'Hello..' },
            { actionType: 'CALL', delayHours: 48, taskTitle: 'Call the prospect' },
          ],
        },
      }),
    )

    expect(message).toContain('Here is your cadence.')
    expect(message).not.toContain('[ACTION]')
    expect(action?.type).toBe('create_cadence')
    if (action?.type === 'create_cadence') {
      expect(action.params.name).toBe('SMB Outbound')
      expect(action.params.steps).toHaveLength(2)
      expect(action.params.steps[0]).toMatchObject({
        actionType: 'EMAIL',
        delayHours: 0,
        subject: 'Hi',
        body: 'Hello..',
      })
      expect(action.params.steps[1]).toMatchObject({
        actionType: 'CALL',
        delayHours: 48,
        taskTitle: 'Call the prospect',
      })
    }
  })

  it('drops the action when steps is empty', () => {
    const { action } = extractActionBlock(
      actionText({ type: 'create_cadence', params: { name: 'X', steps: [] } }),
    )
    expect(action).toBeUndefined()
  })

  it('drops the action when the name is missing', () => {
    const { action } = extractActionBlock(
      actionText({
        type: 'create_cadence',
        params: { steps: [{ actionType: 'EMAIL' }] },
      }),
    )
    expect(action).toBeUndefined()
  })

  it('drops the action on an unknown actionType', () => {
    const { action } = extractActionBlock(
      actionText({
        type: 'create_cadence',
        params: { name: 'X', steps: [{ actionType: 'SMS' }] },
      }),
    )
    expect(action).toBeUndefined()
  })
})

describe('executeChatAction — create_cadence', () => {
  it('creates a draft cadence, adds each step in order, and returns the detail path', async () => {
    mockCreateCadence.mockResolvedValue({ id: 'cad-1' })
    mockAddStep.mockResolvedValue({ id: 'step' })

    const result = await executeChatAction(
      {
        type: 'create_cadence',
        description: 'Create SMB Outbound',
        params: {
          name: 'SMB Outbound',
          steps: [
            { actionType: 'EMAIL', delayHours: 0, subject: 'Hi', body: 'Hello' },
            { actionType: 'CALL', delayHours: 48, taskTitle: 'Call' },
          ],
        },
      },
      'user-1',
      'org-1',
    )

    expect(result.success).toBe(true)
    expect(result.data?.path).toBe('/cadences/cad-1')
    expect(result.data?.cadenceId).toBe('cad-1')

    expect(mockCreateCadence).toHaveBeenCalledWith(
      { name: 'SMB Outbound' },
      'user-1',
      'org-1',
    )
    expect(mockAddStep).toHaveBeenCalledTimes(2)
    expect(mockAddStep).toHaveBeenNthCalledWith(
      1,
      'cad-1',
      expect.objectContaining({
        actionType: 'EMAIL',
        stepOrder: 1,
        delayHours: 0,
        subject: 'Hi',
        body: 'Hello',
      }),
      'org-1',
    )
    expect(mockAddStep).toHaveBeenNthCalledWith(
      2,
      'cad-1',
      expect.objectContaining({
        actionType: 'CALL',
        stepOrder: 2,
        delayHours: 48,
        taskTitle: 'Call',
      }),
      'org-1',
    )
  })

  it('defaults delayHours to 0 when omitted', async () => {
    mockCreateCadence.mockResolvedValue({ id: 'cad-2' })
    mockAddStep.mockResolvedValue({ id: 'step' })

    await executeChatAction(
      {
        type: 'create_cadence',
        description: 'x',
        params: { name: 'Y', steps: [{ actionType: 'MANUAL_TASK', taskTitle: 'Do it' }] },
      },
      'u',
      'o',
    )

    expect(mockAddStep).toHaveBeenCalledWith(
      'cad-2',
      expect.objectContaining({ actionType: 'MANUAL_TASK', delayHours: 0 }),
      'o',
    )
  })

  it('returns a failure result (never throws) when the service errors', async () => {
    mockCreateCadence.mockRejectedValue(new Error('db down'))

    const result = await executeChatAction(
      {
        type: 'create_cadence',
        description: 'x',
        params: { name: 'Z', steps: [{ actionType: 'EMAIL' }] },
      },
      'u',
      'o',
    )

    expect(result.success).toBe(false)
    expect(mockAddStep).not.toHaveBeenCalled()
  })
})
