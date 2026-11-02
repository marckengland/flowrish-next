import { expect, it, vi } from 'vitest'
import { initialCallState } from '@/lib/receptionist'
const mocks = vi.hoisted(() => ({ generate: vi.fn() }))
const version = new Date('2026-11-02T00:00:00Z')
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: async () => ({ id: 'member' }) }, receptionistConfig: { findUnique: async () => ({ updatedAt: version, settings: { enabled: false, businessName: 'Sample', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' } }) } } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: async () => new Set(['admin:settings']) }))
vi.mock('../receptionist-generation', () => ({ generateApprovedReceptionistReply: mocks.generate }))
import { previewReceptionist } from '../receptionist-preview'
it('copies only validated finite diagnostics into the administrator preview', async () => {
 const diagnostics = { provider: 'gemini', structuredOutput: true, finishReason: 'length', stage: 'model' }
 mocks.generate.mockRejectedValue(Object.assign(new SyntaxError('synthetic-private-text'), { receptionistDiagnostic: { ...diagnostics, secret: 'synthetic-private-text' } }))
 const result = await previewReceptionist('org', 'admin', { state: initialCallState(''), settingsVersion: version.toISOString(), speech: 'Help' })
 expect(result.generation).toEqual({ mode: 'fallback', reason: 'invalid_json', diagnostics })
 expect(JSON.stringify(result)).not.toContain('synthetic-private-text')
})
it('omits malformed diagnostic fields instead of forwarding arbitrary values', async () => {
 mocks.generate.mockRejectedValue(Object.assign(new SyntaxError('synthetic-private-text'), { receptionistDiagnostic: { provider: 'synthetic-private-text' } }))
 const result = await previewReceptionist('org', 'admin', { state: initialCallState(''), settingsVersion: version.toISOString(), speech: 'Help' })
 expect(result.generation).toEqual({ mode: 'fallback', reason: 'invalid_json' })
 expect(JSON.stringify(result)).not.toContain('synthetic-private-text')
})
