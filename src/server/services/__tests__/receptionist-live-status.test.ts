import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { initialCallState } from '@/lib/receptionist'
const mocks = vi.hoisted(() => ({ generate: vi.fn(), config: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: async () => ({ id: 'member' }) }, receptionistConfig: { findUnique: mocks.config } } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: async () => new Set(['admin:settings']) }))
vi.mock('../receptionist-generation', () => ({ generateApprovedReceptionistReply: mocks.generate }))
import { previewReceptionist } from '../receptionist-preview'
const version = new Date('2026-11-02T00:00:00.000Z')
beforeEach(() => {
 vi.clearAllMocks()
 mocks.config.mockResolvedValue({ updatedAt: version, settings: { enabled: false, businessName: 'Sample business', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' } })
})
const request = () => previewReceptionist('org', 'admin', { state: initialCallState(''), settingsVersion: version.toISOString(), speech: 'What services do you offer?' })
describe('admin-only live AI status', () => {
 it('identifies successful AI extraction separately from deterministic replies', async () => {
  mocks.generate.mockResolvedValue({ extraction: { fullName: null, phone: null, reason: null, reply: 'We repair bicycles.' }, sources: [] })
  expect((await request()).generation).toEqual({ mode: 'ai' })
  expect((await previewReceptionist('org', 'admin', {})).generation).toBeUndefined()
 })
 it.each([
  ['rate_limited', Object.assign(new AppError('AI_UNAVAILABLE', 'synthetic-secret-details', 503), { providerStatus: 429 })],
  ['provider_unavailable', new AppError('AI_UNAVAILABLE', 'synthetic-secret-details', 503)],
  ['invalid_json', new SyntaxError('synthetic-secret-details')],
  ['invalid_response', new z.ZodError([{ code: 'custom', path: ['reply'], message: 'synthetic-secret-details' }])],
  ['timeout', Object.assign(new Error('synthetic-secret-details'), { name: 'TimeoutError' })],
  ['service_unavailable', new Error('synthetic-secret-details')],
 ])('classifies %s without disclosing provider error text', async (reason, error) => {
  mocks.generate.mockRejectedValue(error)
  const result = await request()
  expect(result.generation).toEqual({ mode: 'fallback', reason })
  expect(result.state.fallbackField).toBe('fullName')
  expect(JSON.stringify(result)).not.toContain('synthetic-secret-details')
 })
})
