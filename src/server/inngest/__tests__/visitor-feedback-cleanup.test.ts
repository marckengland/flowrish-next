import { expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sessions: vi.fn().mockResolvedValue({ sessions: 2, usage: 1 }), feedback: vi.fn().mockResolvedValue(3) }))
vi.mock('@/server/services/website-receptionist', () => ({ cleanupWebsiteReceptionist: mocks.sessions }))
vi.mock('@/server/services/visitor-feedback-retention', () => ({ cleanupVisitorFeedback: mocks.feedback }))
vi.mock('@/server/inngest/client', () => ({ inngest: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) } }))
import { websiteReceptionistCleanupFunction } from '../website-receptionist-cleanup'
it('extends the existing daily cleanup with an independent feedback expiry step', async () => {
  const fn = websiteReceptionistCleanupFunction as unknown as { config: { id: string }; handler: (context: unknown) => Promise<unknown> }, run = vi.fn(async (_name, action) => action())
  expect(fn.config.id).toBe('website-receptionist-cleanup'); await expect(fn.handler({ step: { run } })).resolves.toEqual({ sessions: 2, usage: 1, feedback: 3 }); expect(run.mock.calls.map(call => call[0])).toEqual(['remove-expired-website-sessions', 'remove-expired-visitor-feedback']); expect(mocks.feedback).toHaveBeenCalledOnce()
})
