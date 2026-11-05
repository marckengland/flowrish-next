import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ db: { contactSuppression: { findMany: vi.fn() }, lead: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() }, emailAccount: { findFirst: vi.fn() }, emailMessage: { findFirst: vi.fn(), create: vi.fn() }, activity: { create: vi.fn() } }, fetch: vi.fn(), microsoft: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: mocks.db }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => mocks.db }))
vi.mock('@/lib/encryption', () => ({ decrypt: (v: string) => v, encrypt: (v: string) => v }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/server/services/microsoft-email', () => ({ deliverMicrosoftEmail: mocks.microsoft, refreshMicrosoftTokenIfNeeded: vi.fn() }))
import { sendEmail } from '../email'
const account = { id: 'exact-account', userId: 'user', provider: 'gmail', email: 'owner@example.invalid', accessToken: 'synthetic', tokenExpiry: new Date('2099-01-01') }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.db.lead.findMany.mockResolvedValue([])
  mocks.db.contactSuppression.findMany.mockResolvedValue([])
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.db.lead.findFirst.mockResolvedValue({ id: 'lead', email: 'primary@example.invalid', altEmail: 'alternate@example.invalid', firstName: 'Jane' })
  mocks.db.emailAccount.findFirst.mockResolvedValue(account)
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'sent', threadId: 'source-thread' }) })
})
describe('context-bound follow-up delivery', () => {
  it('uses the exact authorized account and alternate recipient with real RFC reply headers', async () => {
    await sendEmail('lead','Re: Proposal','<p>Reviewed reply</p>','user','org','source-thread',[],{ accountId: 'exact-account', recipientEmail: 'alternate@example.invalid', replyMessageId: '<last@provider.invalid>', replyReferences: '<first@provider.invalid> <last@provider.invalid>' })
    expect(mocks.db.emailAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user', id: 'exact-account' } }))
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    const wire = Buffer.from(payload.raw.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')
    expect(wire).toContain('To: alternate@example.invalid')
    expect(wire).toContain('In-Reply-To: <last@provider.invalid>')
    expect(wire).toContain('References: <first@provider.invalid> <last@provider.invalid>')
    expect(wire).not.toContain('@mail.gmail.com>')
    expect(payload.threadId).toBe('source-thread')
    expect(mocks.db.emailMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ accountId: 'exact-account', toEmail: 'alternate@example.invalid' }) }))
  })
  it('rejects an arbitrary recipient and injected reply headers before an outbound request', async () => {
    await expect(sendEmail('lead','Subject','Body','user','org','thread',[],{ accountId: 'exact-account', recipientEmail: 'attacker@example.invalid' })).rejects.toThrow()
    await expect(sendEmail('lead','Subject','Body','user','org','thread',[],{ accountId: 'exact-account', recipientEmail: 'alternate@example.invalid', replyMessageId: '<real@example.invalid>\r\nBcc: attacker@example.invalid' })).rejects.toThrow()
    await expect(sendEmail('lead','Reviewed subject\r\nBcc: attacker@example.invalid','Body','user','org','thread',[],{ accountId: 'exact-account', recipientEmail: 'alternate@example.invalid' })).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
