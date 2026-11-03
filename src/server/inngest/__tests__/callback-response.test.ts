import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn((config: unknown, handler: unknown) => ({ config, handler })), page: vi.fn() }))
vi.mock('../client', () => ({ inngest: { createFunction: mocks.create } }))
vi.mock('@/server/services/callback-response-reconciliation', () => ({ reconcileCallbackResponsePage: mocks.page }))
import { callbackResponseFunction } from '../callback-response'
describe('isolated callback response scheduler', () => {
  it('durably pages enabled policies and retries failures without invoking provider transports', async () => {
    const fn = callbackResponseFunction as unknown as { config: unknown; handler: (args: { step: { run: (name: string, action: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown> }
    expect(fn.config).toEqual({ id: 'callback-response-targets', concurrency: 1, retries: 3, triggers: [{ cron: '*/5 * * * *' }] }); const names: string[] = [], step = { run: async (name: string, action: () => Promise<unknown>) => { names.push(name); return action() } }
    mocks.page.mockResolvedValueOnce({ after: 'next', organizations: 25, targets: 10, notifications: 2 }).mockResolvedValueOnce({ after: null, organizations: 1, targets: 1, notifications: 1 }); expect(await fn.handler({ step })).toEqual({ organizations: 26, targets: 11, notifications: 3 }); expect(names).toEqual(['response-page-0', 'response-page-1']); expect(mocks.page.mock.calls.map(call => call[0])).toEqual(['', 'next']); mocks.page.mockRejectedValueOnce(new Error('retry')); await expect(fn.handler({ step })).rejects.toThrow('retry')
  })
})
