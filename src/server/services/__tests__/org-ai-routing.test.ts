import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialCallState, type ReceptionistConfig } from '@/lib/receptionist'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), reserve: vi.fn(), finish: vi.fn(), env: { AI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_API_KEY: 'platform-synthetic-key', AI_MODEL: 'platform-model' } }))
vi.mock('@/lib/env', () => ({ env: mocks.env }))
vi.mock('../org-ai-provider', () => ({ resolveOrganizationAi: mocks.resolve, reserveAiUsage: mocks.reserve, finishAiUsage: mocks.finish }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ aiPromptConfig: { findFirst: async () => null }, lead: { findFirst: async () => ({ firstName: 'Sample', lastName: 'Caller', activities: [] }) } }) }))
vi.mock('../knowledge', () => ({ getAirishKnowledge: async () => ({ text: '', sources: [] }) }))
import { chatMessageStream, generateEmail, generateReceptionistReply } from '../ai'
const config: ReceptionistConfig = { enabled: false, businessName: 'Sample', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
const extraction = { fullName: null, phone: null, reason: null, reply: 'A tune-up costs PHP 750.' }
const runtime = (organizationId = 'org-a') => ({ organizationId, version: new Date('2026-11-02T00:00:00Z'), provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: `synthetic-${organizationId}-key`, dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 256, maxInputBytes: 16000 })
beforeEach(() => {
 vi.clearAllMocks()
 mocks.env.AI_API_KEY = 'platform-synthetic-key'
 mocks.resolve.mockImplementation(async organizationId => runtime(organizationId))
 mocks.reserve.mockImplementation(async selected => ({ organizationId: selected.organizationId, day: new Date('2026-11-02'), reservedTokens: 2000 }))
 mocks.finish.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function provider() {
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(extraction) }, finish_reason: 'stop' }], usage: { total_tokens: 120 } }) })
 vi.stubGlobal('fetch', fetch)
 return fetch
}
it('uses each organization key/model and caps output without shared-key fallback', async () => {
 const fetch = provider()
 for (const organizationId of ['org-a', 'org-b']) await generateReceptionistReply(initialCallState(''), config, organizationId)
 expect(mocks.resolve.mock.calls.map(call => call[0])).toEqual(['org-a', 'org-b'])
 expect(fetch.mock.calls.map(call => call[1].headers.Authorization)).toEqual(['Bearer synthetic-org-a-key', 'Bearer synthetic-org-b-key'])
 const body = JSON.parse(fetch.mock.calls[0][1].body)
 expect(body).toMatchObject({ model: 'deepseek-flash', max_tokens: 256, thinking: { type: 'disabled' } })
 expect(fetch.mock.calls[0][1].redirect).toBe('error')
 expect(mocks.reserve.mock.calls[0][1]).toBe(Buffer.byteLength(fetch.mock.calls[0][1].body, 'utf8'))
 expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a' }), { success: true, totalTokens: 120 })
})
it('uses the deployment provider only when no organization configuration exists', async () => {
 mocks.resolve.mockResolvedValue(null)
 const fetch = provider()
 await generateReceptionistReply(initialCallState(''), config, 'org-a')
 expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer platform-synthetic-key')
 expect(mocks.reserve).not.toHaveBeenCalled()
})
it.each(['AI_DISABLED', 'AI_LIMIT_REACHED', 'AI_CONFIGURATION_INVALID'])('does not send a request when organization setup rejects with %s', async code => {
 mocks.resolve.mockRejectedValue(new AppError(code, 'Organization AI unavailable.', 503))
 const fetch = provider()
 await expect(generateReceptionistReply(initialCallState(''), config, 'org-a')).rejects.toMatchObject({ code })
 expect(fetch).not.toHaveBeenCalled()
})
it('rejects exhausted reservations before calling any provider', async () => {
 mocks.reserve.mockRejectedValue(new AppError('AI_LIMIT_REACHED', 'Daily allowance reached.', 429))
 const fetch = provider()
 await expect(generateReceptionistReply(initialCallState(''), config, 'org-a')).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' })
 expect(fetch).not.toHaveBeenCalled()
})
it('works with an organization key when no deployment AI key is configured', async () => {
 mocks.env.AI_API_KEY = ''
 const fetch = provider()
 await generateReceptionistReply(initialCallState(''), config, 'org-a')
 expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-org-a-key')
})
it('fails before fetch when neither an organization nor deployment key exists', async () => {
 mocks.env.AI_API_KEY = ''
 mocks.resolve.mockResolvedValue(null)
 const fetch = provider()
 await expect(generateReceptionistReply(initialCallState(''), config, 'org-a')).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
 expect(fetch).not.toHaveBeenCalled()
})
it('retains failed usage without logging raw provider text or credentials', async () => {
 const log = vi.spyOn(console, 'error').mockImplementation(() => {})
 const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'synthetic-org-a-key' })
 vi.stubGlobal('fetch', fetch)
 await expect(generateEmail('lead', 'user', 'org-a')).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
 expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { success: false, totalTokens: undefined })
 expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-org-a-key')
})
it('aborts a cancelled stream and retains its reserved allowance', async () => {
 let cancelled = false
 const fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello there"}}]}\n\n')) }, cancel() { cancelled = true } }) })
 vi.stubGlobal('fetch', fetch)
 const stream = chatMessageStream('Hello', 'user', 'org-a')
 expect((await stream.next()).value).toMatchObject({ type: 'delta', text: 'Hello there' })
 await stream.return({ message: 'Cancelled' })
 expect(cancelled).toBe(true)
 expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
 expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { success: false, totalTokens: undefined })
})
it('records reported usage when an organization stream reaches DONE', async () => {
 const fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":75}}\n\ndata: [DONE]\n\n')); controller.close() } }) })
 vi.stubGlobal('fetch', fetch)
 for await (const _event of chatMessageStream('Hello', 'user', 'org-a')) { /* Consume provider response. */ }
 expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { success: true, totalTokens: 75 })
})
it('rejects a provider EOF without a terminal completion instead of marking a partial answer complete', async () => {
 vi.spyOn(console, 'error').mockImplementation(() => {})
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n')); controller.close() } }) }))
 const consume = async () => { for await (const _event of chatMessageStream('Hello', 'user', 'org-a')) { /* Consume partial reply. */ } }
 await expect(consume()).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' })
 expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { success: false, totalTokens: undefined })
})
it('aborts an idle provider read when the caller cancels the request', async () => {
 vi.spyOn(console, 'error').mockImplementation(() => {})
 let cancelled = false
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n')) }, cancel() { cancelled = true } }) }))
 const controller = new AbortController()
 const stream = chatMessageStream('Hello', 'user', 'org-a', [], controller.signal)
 await stream.next()
 const pending = stream.next().then(value => value, error => error)
 controller.abort()
 expect(await pending).toMatchObject({ code: 'AI_UNAVAILABLE' })
 expect(cancelled).toBe(true)
 expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), { success: false, totalTokens: undefined })
})
