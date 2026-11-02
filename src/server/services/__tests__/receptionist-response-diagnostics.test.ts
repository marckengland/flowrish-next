import { afterEach, expect, it, vi } from 'vitest'
import { initialCallState, type ReceptionistConfig } from '@/lib/receptionist'
vi.mock('@/lib/env', () => ({ env: { AI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_MODEL: 'sample-model', AI_API_KEY: 'synthetic-key' } }))
import { generateReceptionistReply } from '../ai'
const config: ReceptionistConfig = { enabled: false, businessName: 'Sample business', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it.each([
 ['https://generativelanguage.googleapis.com/v1beta/openai', 'gemini', true, 'length'],
 ['https://api.tokenrouter.com/v1', 'tokenrouter', false, 'stop'],
])('reports only safe format/completion facts for %s', async (url, provider, structuredOutput, finishReason) => {
 vi.stubEnv('AI_API_URL', url)
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'synthetic-invalid-json' }, finish_reason: finishReason }] }) }))
 let failure: unknown
 try { await generateReceptionistReply(initialCallState(''), config) } catch (error) { failure = error }
 expect(failure).toMatchObject({ receptionistDiagnostic: { provider, structuredOutput, finishReason, stage: 'model' } })
 expect(JSON.stringify((failure as { receptionistDiagnostic: unknown }).receptionistDiagnostic)).not.toContain('synthetic-key')
 expect(JSON.stringify((failure as { receptionistDiagnostic: unknown }).receptionistDiagnostic)).not.toContain('synthetic-invalid-json')
})
it('distinguishes an unreadable provider envelope from malformed model JSON', async () => {
 vi.stubEnv('AI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/openai')
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('synthetic envelope text') } }))
 await expect(generateReceptionistReply(initialCallState(''), config)).rejects.toMatchObject({ receptionistDiagnostic: { provider: 'gemini', structuredOutput: true, finishReason: 'unknown', stage: 'provider' } })
})
