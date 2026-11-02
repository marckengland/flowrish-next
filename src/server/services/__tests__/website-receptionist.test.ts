import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), config: vi.fn(), business: vi.fn(), ai: vi.fn(), documents: vi.fn(), usage: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { organizationMember: { findUnique: mocks.member }, websiteReceptionistConfig: { findUnique: mocks.config }, receptionistConfig: { findUnique: mocks.business }, aiProviderConfig: { findUnique: mocks.ai }, knowledgeDocument: { count: mocks.documents, fields: { publishedRevision: 'publishedRevision' } }, websiteReceptionistUsage: { findUnique: mocks.usage } } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mocks.permissions }))
vi.mock('../website-receptionist-generation', () => ({ generateWebsiteReceptionistAnswer: vi.fn() }))
import { getWebsiteReceptionistAdmin, startWebsiteSession } from '../website-receptionist'
describe('website receptionist private defaults', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.member.mockResolvedValue({ id: 'member' }); mocks.permissions.mockResolvedValue(new Set(['admin:settings'])); mocks.config.mockResolvedValue(null); mocks.business.mockResolvedValue(null); mocks.ai.mockResolvedValue(null); mocks.documents.mockResolvedValue(0); mocks.usage.mockResolvedValue(null) })
  it('does not create settings or expose provider credentials on reads', async () => {
    expect(await getWebsiteReceptionistAdmin('org', 'user')).toEqual({ settings: null, hasSavedBusiness: false, approvedDocuments: 0, hasOrganizationAi: false, usage: { sessions: 0, messages: 0, reservedTokens: 0, callbacks: 0 } })
    expect(mocks.ai.mock.calls[0][0].select.apiKeyCiphertext).toBeUndefined()
  })
  it('requires fresh membership and effective settings permission', async () => {
    mocks.member.mockResolvedValue(null)
    await expect(getWebsiteReceptionistAdmin('org', 'user')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('sanitizes unexpected database errors', async () => {
    mocks.member.mockRejectedValue(new Error('secret provider token'))
    await expect(getWebsiteReceptionistAdmin('org', 'user')).rejects.toMatchObject({ message: 'Website receptionist is temporarily unavailable.' })
  })
  it('rejects a honeypot before any config lookup', async () => {
    await expect(startWebsiteSession('92b99edf-4968-4876-a597-5b9cc43c842b', { siteOrigin: 'https://example.invalid', website: 'bot' }, { ip: '192.0.2.1', origin: 'https://app.invalid' })).rejects.toBeDefined()
    expect(mocks.config).not.toHaveBeenCalled()
  })
})
