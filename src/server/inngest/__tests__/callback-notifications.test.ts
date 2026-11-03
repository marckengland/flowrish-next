import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn((config: unknown, handler: unknown) => ({ config, handler })), sweep: vi.fn() }))
vi.mock('../client', () => ({ inngest: { createFunction: mocks.create } }))
vi.mock('@/server/services/callback-notifications', () => ({ runCallbackNotificationSweep: mocks.sweep }))
import { callbackNotificationFunction } from '../callback-notifications'
describe('callback notification scheduler', () => {
  it('registers an isolated five-minute retryable sweep and lets failures retry', async () => {
    const fn = callbackNotificationFunction as unknown as { config: unknown; handler: (args: { step: { run: (name: string, action: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown> }
    expect(fn.config).toEqual({ id: 'callback-notifications', retries: 3, concurrency: 1, triggers: [{ cron: '*/5 * * * *' }] })
    const step = { run: async (_name: string, action: () => Promise<unknown>) => action() }; mocks.sweep.mockResolvedValueOnce({ organizations: 2, created: 3 }); expect(await fn.handler({ step })).toEqual({ organizations: 2, created: 3 })
    mocks.sweep.mockRejectedValueOnce(new Error('retryable')); await expect(fn.handler({ step })).rejects.toThrow('retryable')
  })
})
