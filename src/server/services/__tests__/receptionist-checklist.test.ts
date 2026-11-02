import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), config: vi.fn(), documents: vi.fn(), stage: vi.fn(), ai: vi.fn(), usage: vi.fn(), env: { AI_API_KEY: 'synthetic-platform-key' } }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: mocks.member }, receptionistConfig: { findUnique: mocks.config }, knowledgeDocument: { count: mocks.documents, fields: { publishedRevision: 'publishedRevision' } }, stage: { findFirst: mocks.stage }, aiProviderConfig: { findUnique: mocks.ai }, aiUsageDay: { findUnique: mocks.usage } } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mocks.permissions }))
vi.mock('@/lib/env', () => ({ env: mocks.env }))
import { getReceptionistChecklist } from '../receptionist-checklist'
const userId = '11111111-1111-4111-8111-111111111111', stageId = '22222222-2222-4222-8222-222222222222'
const settings = { enabled: false, businessName: 'Synthetic bicycle repairs', knowledge: 'Approved manual FAQs', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: userId, stageId }
const ai = { provider: 'deepseek', model: 'deepseek-flash', enabled: true, dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000, updatedAt: new Date('2026-11-02T00:00:00Z') }
beforeEach(() => {
 vi.clearAllMocks()
 mocks.member.mockResolvedValue({ id: 'membership' })
 mocks.permissions.mockResolvedValue(new Set(['admin:settings']))
 mocks.config.mockResolvedValue({ settings, updatedAt: new Date('2026-11-02T00:00:00Z') })
 mocks.documents.mockResolvedValue(2)
 mocks.stage.mockResolvedValue({ id: stageId })
 mocks.ai.mockResolvedValue(ai)
 mocks.usage.mockResolvedValue({ requests: 1, reservedTokens: 5000 })
 mocks.env.AI_API_KEY = 'synthetic-platform-key'
})
it('reports five saved setup checks without provider calls, secret fields, or live-verification claims', async () => {
 const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No provider transport permitted'))
 const result = await getReceptionistChecklist('org', userId)
 expect(result.scope).toBe('saved_setup')
 expect(result.checks.map(check => [check.id, check.status])).toEqual([['business', 'complete'], ['hours', 'complete'], ['knowledge', 'complete'], ['callbacks', 'complete'], ['ai', 'complete']])
 expect(result.checks.find(check => check.id === 'ai')?.detail).toMatch(/not.*verified/i)
 expect(mocks.ai).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org' }, select: expect.any(Object) }))
 const select = mocks.ai.mock.calls[0][0].select
 expect(select).not.toHaveProperty('apiKeyCiphertext')
 expect(select).not.toHaveProperty('apiKey')
 expect(JSON.stringify(result)).not.toContain('synthetic-platform-key')
 expect(fetch).not.toHaveBeenCalled()
 fetch.mockRestore()
})
it('checks only current approved public documents and current-organization callback targets', async () => {
 await getReceptionistChecklist('org', userId)
 expect(mocks.documents).toHaveBeenCalledWith({ where: { organizationId: 'org', archivedAt: null, publishedAt: { not: null }, receptionistApprovedRevision: { equals: 'publishedRevision' } } })
 expect(mocks.member).toHaveBeenCalledWith({ where: { userId_organizationId: { userId, organizationId: 'org' } }, select: { id: true } })
 expect(mocks.stage).toHaveBeenCalledWith({ where: { id: stageId, pipeline: { organizationId: 'org' }, isClosedWon: false, isClosedLost: false }, select: { id: true } })
})
it('reports missing setup while retaining a configured deployment fallback', async () => {
 mocks.config.mockResolvedValue(null)
 mocks.documents.mockResolvedValue(0)
 mocks.ai.mockResolvedValue(null)
 const result = await getReceptionistChecklist('org', userId)
 expect(result.settingsVersion).toBeNull()
 expect(result.checks.filter(check => check.status === 'complete').map(check => check.id)).toEqual(['ai'])
 expect(mocks.stage).not.toHaveBeenCalled()
})
it('requires knowledge unless saved FAQs or approved public documents exist', async () => {
 mocks.config.mockResolvedValue({ settings: { ...settings, knowledge: '' }, updatedAt: new Date() })
 mocks.documents.mockResolvedValue(0)
 expect((await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'knowledge')?.status).toBe('attention')
 mocks.documents.mockResolvedValue(1)
 expect((await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'knowledge')?.status).toBe('complete')
})
it.each([
 [{ ...ai, enabled: false }, { requests: 0, reservedTokens: 0 }],
 [{ ...ai, provider: 'unsupported' }, { requests: 0, reservedTokens: 0 }],
 [ai, { requests: 20, reservedTokens: 0 }],
 [ai, { requests: 1, reservedTokens: 50000 }],
])('never uses platform fallback for paused, invalid, or exhausted organization setup %#', async (config, usage) => {
 mocks.ai.mockResolvedValue(config)
 mocks.usage.mockResolvedValue(usage)
 const check = (await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'ai')!
 expect(check.status).toBe('attention')
 expect(check.detail).not.toMatch(/platform.*configured/i)
})
it('requires an AI connection when neither organization settings nor deployment credentials exist', async () => {
 mocks.ai.mockResolvedValue(null)
 mocks.env.AI_API_KEY = ''
 expect((await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'ai')?.status).toBe('attention')
})
it('requires enough allowance for the configured input and output reservation, including overhead', async () => {
 const reservation = ai.maxInputBytes + 256 + ai.maxOutputTokens
 for (const remaining of [300, reservation - 1]) {
  mocks.usage.mockResolvedValue({ requests: 1, reservedTokens: ai.dailyTokenLimit - remaining })
  expect((await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'ai')?.status).toBe('attention')
 }
 mocks.usage.mockResolvedValue({ requests: 1, reservedTokens: ai.dailyTokenLimit - reservation })
 expect((await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'ai')?.status).toBe('complete')
})
it('detects a removed callback owner or closed/unavailable stage', async () => {
 mocks.stage.mockResolvedValue(null)
 expect((await getReceptionistChecklist('org', userId)).checks.find(check => check.id === 'callbacks')?.status).toBe('attention')
 mocks.stage.mockResolvedValue({ id: stageId })
 mocks.member.mockImplementation(async ({ where }) => ({ id: where.userId_organizationId.userId === 'requester' ? 'requester-member' : null }).id ? { id: 'requester-member' } : null)
 expect((await getReceptionistChecklist('org', 'requester')).checks.find(check => check.id === 'callbacks')?.status).toBe('attention')
})
it('checks current membership and organization permissions before reading any setup', async () => {
 mocks.member.mockResolvedValue(null)
 await expect(getReceptionistChecklist('org', userId)).rejects.toMatchObject({ statusCode: 403 })
 expect(mocks.config).not.toHaveBeenCalled()
 mocks.member.mockResolvedValue({ id: 'member' })
 mocks.permissions.mockResolvedValue(new Set(['leads:read']))
 await expect(getReceptionistChecklist('other-org', userId)).rejects.toMatchObject({ statusCode: 403 })
 expect(mocks.ai).not.toHaveBeenCalled()
})
