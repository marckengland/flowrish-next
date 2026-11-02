import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WEBSITE_REPLY_INPUT_BYTES, WEBSITE_REPLY_OUTPUT_TOKENS } from '@/lib/website-receptionist'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), reserve: vi.fn(), finish: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { AI_API_URL: 'https://deployment.example.invalid/v1', AI_API_KEY: 'synthetic-deployment-key', AI_MODEL: 'synthetic-model' } }))
vi.mock('@/server/services/org-ai-provider', () => ({ resolveOrganizationAi: mocks.resolve, reserveAiUsage: mocks.reserve, finishAiUsage: mocks.finish }))
import { generateWebsiteReceptionistText } from '../ai'
const runtime = { organizationId: 'org', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'synthetic-org-key', maxInputBytes: 16000, maxOutputTokens: 2048, dailyRequestLimit: 20, dailyTokenLimit: 50000, version: new Date('2026-11-03T00:00:00Z') }
let transport: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue(runtime)
  mocks.reserve.mockResolvedValue({ organizationId: 'org', day: new Date(), reservedTokens: 3000 })
  mocks.finish.mockResolvedValue(undefined)
  transport = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'We open Sundays from 10 AM to 2 PM.' }, finish_reason: 'stop' }], usage: { total_tokens: 40 } }) })
  vi.stubGlobal('fetch', transport)
})
afterEach(() => { vi.unstubAllGlobals() })
describe('public website provider policy', () => {
  it('requires an organization provider and never falls back to deployment credentials', async () => {
    mocks.resolve.mockResolvedValue(null)
    await expect(generateWebsiteReceptionistText('org', 'Sample business', 'Hours?', [], 'Approved hours')).rejects.toBeDefined()
    expect(transport).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled()
  })
  it('clamps public input/output while preserving org-wide reservation and strict callback separation', async () => {
    expect(await generateWebsiteReceptionistText('org', 'Sample business', 'Hours?', ['Services?'], 'Approved Sunday hours: 10 AM to 2 PM.')).toContain('Sundays')
    const [limits, bytes, output] = mocks.reserve.mock.calls[0]
    expect(limits.maxInputBytes).toBe(WEBSITE_REPLY_INPUT_BYTES)
    expect(output).toBe(WEBSITE_REPLY_OUTPUT_TOKENS)
    expect(bytes).toBeLessThanOrEqual(WEBSITE_REPLY_INPUT_BYTES)
    const request = transport.mock.calls[0][1], body = JSON.parse(request.body)
    expect(body.max_tokens).toBe(WEBSITE_REPLY_OUTPUT_TOKENS)
    expect(body.messages.map((item: { role: string }) => item.role)).toEqual(['system', 'user', 'user'])
    expect(body.messages[0].content).toMatch(/callback form/i)
    expect(request.headers.Authorization).toBe('Bearer synthetic-org-key')
    expect(request.redirect).toBe('error')
    expect(mocks.finish).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ success: true }))
  })
  it('fails closed before transport when the public byte limit is exceeded', async () => {
    await expect(generateWebsiteReceptionistText('org', 'Business', 'Question?', [], 'x'.repeat(10000))).rejects.toBeDefined()
    expect(transport).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled()
  })
  it('never requests more output than a smaller organization limit', async () => {
    mocks.resolve.mockResolvedValue({ ...runtime, maxInputBytes: 4000, maxOutputTokens: 128 })
    await generateWebsiteReceptionistText('org', 'Business', 'Hours?', [], 'Approved hours')
    expect(mocks.reserve.mock.calls[0][0].maxInputBytes).toBe(4000)
    expect(mocks.reserve.mock.calls[0][2]).toBe(128)
  })
})
