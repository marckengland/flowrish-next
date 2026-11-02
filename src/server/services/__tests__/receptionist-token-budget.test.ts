import { afterEach, expect, it, vi } from 'vitest'
import { initialCallState, type ReceptionistConfig } from '@/lib/receptionist'
vi.mock('@/lib/env', () => ({ env: { AI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_MODEL: 'sample-model', AI_API_KEY: 'synthetic-key' } }))
import { generateReceptionistReply } from '../ai'
const config: ReceptionistConfig = { enabled: false, businessName: 'Sample', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it.each([
 ['https://generativelanguage.googleapis.com/v1beta/openai', 2048, 'low'],
 ['https://custom.example.invalid/v1', 500, undefined],
])('bounds receptionist generation for %s without changing custom adapters', async (url, tokens, effort) => {
 vi.stubEnv('AI_API_URL', url)
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ fullName: null, phone: null, reason: null, reply: 'Please call us.' }) }, finish_reason: 'stop' }] }) })
 vi.stubGlobal('fetch', fetch)
 await generateReceptionistReply(initialCallState(''), config)
 const request = fetch.mock.calls[0][1]
 const body = JSON.parse(request.body)
 expect(body.max_tokens).toBe(tokens)
 expect(body.reasoning_effort).toBe(effort)
 expect(request.signal).toBeInstanceOf(AbortSignal)
})
