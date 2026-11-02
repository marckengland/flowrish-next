import { afterEach, expect, it, vi } from 'vitest'
import { initialCallState, type ReceptionistConfig } from '@/lib/receptionist'
vi.mock('@/lib/env', () => ({ env: { AI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_MODEL: 'sample-model', AI_API_KEY: 'synthetic-key' } }))
import { generateReceptionistReply } from '../ai'
const config: ReceptionistConfig = { enabled: false, businessName: 'Sample business', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
const answer = { fullName: null, phone: null, reason: null, reply: 'We repair bicycles.' }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function provider(content = JSON.stringify(answer)) {
 const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) })
 vi.stubGlobal('fetch', fetch)
 return fetch
}
it('requests schema-constrained JSON from the Gemini compatibility endpoint', async () => {
 vi.stubEnv('AI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/openai')
 const fetch = provider()
 expect(await generateReceptionistReply(initialCallState(''), config)).toEqual(answer)
 const body = JSON.parse(fetch.mock.calls[0][1].body)
 expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: { type: 'object', additionalProperties: false, required: ['fullName', 'phone', 'reason', 'reply'] } } })
 expect(Object.keys(body.response_format.json_schema.schema.properties)).toEqual(['fullName', 'phone', 'reason', 'reply'])
})
it('preserves prompt-based JSON for custom providers with unknown schema support', async () => {
 vi.stubEnv('AI_API_URL', 'https://custom.example.invalid/v1')
 const fetch = provider()
 await generateReceptionistReply(initialCallState(''), config)
 expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('response_format')
})
it('still rejects malformed responses even when JSON output was requested', async () => {
 vi.stubEnv('AI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/openai')
 provider('not JSON')
 await expect(generateReceptionistReply(initialCallState(''), config)).rejects.toBeInstanceOf(SyntaxError)
})
it('keeps international-phone validation after structured generation', async () => {
 vi.stubEnv('AI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/openai')
 provider(JSON.stringify({ ...answer, phone: '123' }))
 await expect(generateReceptionistReply(initialCallState(''), config)).rejects.toThrow()
})
