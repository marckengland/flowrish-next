import { afterEach, expect, it, vi } from 'vitest'
import { initialCallState, type ReceptionistConfig } from '@/lib/receptionist'
import { errorResponse } from '@/lib/errors'
vi.mock('@/lib/env', () => ({ env: { AI_API_URL: 'https://provider.example.invalid/v1', AI_MODEL: 'sample-model', AI_API_KEY: 'synthetic-key' } }))
import { generateReceptionistReply } from '../ai'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('keeps upstream rate-limit status for admin diagnostics while the public error stays generic', async () => {
 vi.spyOn(console, 'error').mockImplementation(() => {})
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
 const config: ReceptionistConfig = { enabled: false, businessName: 'Sample business', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
 let failure: unknown
 try { await generateReceptionistReply(initialCallState(''), config) } catch (error) { failure = error }
 expect(failure).toMatchObject({ code: 'AI_UNAVAILABLE', statusCode: 503, providerStatus: 429 })
 const response = errorResponse(failure)
 expect(response.status).toBe(503)
 const body = await response.json()
 expect(body.error.code).toBe('AI_UNAVAILABLE')
 expect(JSON.stringify(body)).not.toContain('providerStatus')
 expect(JSON.stringify(body)).not.toContain('synthetic-key')
})

it('accepts a complete Markdown-wrapped JSON response without relaxing field validation', async () => {
 const answer = { fullName: null, phone: null, reason: null, reply: 'We repair bicycles.' }
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '```json' + String.fromCharCode(10) + JSON.stringify(answer) + String.fromCharCode(10) + '```' } }] }) }))
 const config: ReceptionistConfig = { enabled: false, businessName: 'Sample business', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
 expect(await generateReceptionistReply(initialCallState(''), config)).toEqual(answer)
})
