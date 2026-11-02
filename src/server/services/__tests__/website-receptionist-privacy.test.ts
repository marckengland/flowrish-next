import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ finish: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/server/services/org-ai-provider', () => ({ resolveOrganizationAi: async () => ({ organizationId: 'org', version: new Date(), provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'fictional-model', apiKey: 'fictional-org-key', dailyRequestLimit: 20, dailyTokenLimit: 50000, maxInputBytes: 16000, maxOutputTokens: 2048 }), reserveAiUsage: async () => ({ organizationId: 'org' }), finishAiUsage: mocks.finish }))
import { generateWebsiteReceptionistText } from '../ai'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('does not log public provider failures or failed usage reporting', async () => {
  const logging = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.finish.mockRejectedValue(new Error('fictional usage failure'))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
  await expect(generateWebsiteReceptionistText('org', 'Fictional business', 'Hours?', [], 'Approved hours.')).rejects.toBeDefined()
  expect(logging).not.toHaveBeenCalled()
})
