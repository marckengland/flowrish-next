import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, lead: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() }, contactSuppression: { findMany: vi.fn() }, emailAccount: { findFirst: vi.fn() }, emailMessage: { findFirst: vi.fn(), create: vi.fn() }, activity: { create: vi.fn() } }, fetch: vi.fn(), blocked: false }))
vi.mock('@/server/db/client', () => ({ prisma: m.db }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => m.db }))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/encryption', () => ({ encrypt: () => 'synthetic', decrypt: () => 'synthetic' }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null, assignedUserId: 'actor' })) }))
import { sendEmail } from '../email'
const account = { id: 'account', userId: 'actor', organizationId: 'org', email: 'owner@example.invalid', provider: 'gmail', accessToken: 'synthetic', tokenExpiry: new Date('2099-01-01') }
beforeEach(() => {
  vi.resetAllMocks(); m.blocked = false; vi.stubGlobal('fetch', m.fetch); m.db.lead.findFirst.mockResolvedValue({ id: 'lead', organizationId: 'org', email: 'lead@example.invalid', altEmail: null, firstName: 'Practice', lastName: 'Clinic', updatedAt: new Date('2026-11-05') }); m.db.lead.findMany.mockResolvedValue([]); m.db.emailAccount.findFirst.mockResolvedValue(account); m.db.contactSuppression.findMany.mockImplementation(async () => m.blocked ? [{ email: 'lead@example.invalid', blocked: true }] : []); m.db.user.findUnique.mockResolvedValue({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { hierarchy: 3, permissions: [{ key: 'leads:read' }, { key: 'leads:write' }] } }] }); m.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: 'mock-message', threadId: 'thread', conversationId: 'thread' })))
})
afterEach(() => { vi.unstubAllGlobals() })
it('blocks background sends before tokens or transport when contact restriction is active', async () => { m.blocked = true; await expect(sendEmail('lead', 'Subject', 'Body', 'actor', 'org')).rejects.toMatchObject({ code: 'CONTACT_BLOCKED' }); expect(m.fetch).not.toHaveBeenCalled(); expect(m.db.emailAccount.findFirst).not.toHaveBeenCalled(); expect(m.db.activity.create).not.toHaveBeenCalled() })
it('checks suppression after token refresh for all background recipients', async () => { let reads = 0; m.db.emailAccount.findFirst.mockImplementation(async () => { if (++reads === 3) m.blocked = true; return account }); await expect(sendEmail('lead', 'Subject', 'Body', 'actor', 'org')).rejects.toMatchObject({ code: 'CONTACT_BLOCKED' }); expect(m.fetch).not.toHaveBeenCalled() })
it('checks again after a legacy Gmail thread lookup waits', async () => { m.db.emailMessage.findFirst.mockImplementation(async () => { m.blocked = true; return { externalId: 'source', messageIdHeader: '<source@example.invalid>' } }); await expect(sendEmail('lead', 'Subject', 'Body', 'actor', 'org', 'thread')).rejects.toMatchObject({ code: 'CONTACT_BLOCKED' }); expect(m.fetch).not.toHaveBeenCalled() })
it('stops Microsoft delivery after a block arrives while the provider draft is created', async () => { m.db.emailAccount.findFirst.mockResolvedValue({ ...account, provider: 'microsoft' }); m.fetch.mockImplementation(async () => { m.blocked = true; return new Response(JSON.stringify({ id: 'provider-draft', conversationId: 'thread' })) }); await expect(sendEmail('lead', 'Subject', 'Body', 'actor', 'org')).rejects.toMatchObject({ code: 'CONTACT_BLOCKED' }); expect(m.fetch).toHaveBeenCalledOnce(); expect(String(m.fetch.mock.calls[0][0])).not.toContain('/send') })
it('never treats an unavailable suppression registry as permission to send', async () => { m.db.contactSuppression.findMany.mockRejectedValue(new Error('Private database error')); await expect(sendEmail('lead', 'Subject', 'Body', 'actor', 'org')).rejects.toMatchObject({ code: 'CONTACT_POLICY_UNAVAILABLE', statusCode: 503 }); expect(m.fetch).not.toHaveBeenCalled() })
it('applies the same block to a permitted manual sender without weakening current-access checks', async () => { m.blocked = true; await expect(sendEmail('lead', 'Subject', 'Body', 'actor', 'org', undefined, [], { manualActor: true })).rejects.toMatchObject({ code: 'CONTACT_BLOCKED' }); expect(m.fetch).not.toHaveBeenCalled() })
it('allows a reviewed manual send through mocked transport when no related address is blocked', async () => { await sendEmail('lead', 'Subject', 'Body', 'actor', 'org', undefined, [], { manualActor: true }); expect(m.fetch).toHaveBeenCalledOnce(); expect(m.db.contactSuppression.findMany).toHaveBeenCalled(); expect(m.db.activity.create).toHaveBeenCalled() })
it('binds background Outlook reply recipients instead of delivering to a retained blocked Reply-To address', async () => {
  const old = 'blocked-old@example.invalid'; let actualRecipient = old, cc = [old], bcc = [old]
  m.db.emailAccount.findFirst.mockResolvedValue({ ...account, provider: 'microsoft' })
  m.db.contactSuppression.findMany.mockImplementation(async ({ where }) => where.email.in.includes(old) ? [{ email: old, blocked: true }] : [])
  m.fetch.mockImplementation(async (url: string, options) => {
    if (!options?.method || options.method === 'GET') return new Response(JSON.stringify({ value: [{ id: 'source' }] }))
    if (url.endsWith('/createReply')) return new Response(JSON.stringify({ id: 'draft', conversationId: 'thread' }))
    if (options.method === 'PATCH') { const payload = JSON.parse(options.body); if (payload.toRecipients) { actualRecipient = payload.toRecipients[0].emailAddress.address; cc = payload.ccRecipients ?? cc; bcc = payload.bccRecipients ?? bcc } }
    return new Response(JSON.stringify({ id: 'draft', conversationId: 'thread' }))
  })
  await sendEmail('lead', 'Subject', 'Body', 'actor', 'org', 'thread')
  expect(actualRecipient).toBe('lead@example.invalid'); expect(cc).toEqual([]); expect(bcc).toEqual([]); expect(m.fetch.mock.calls.filter(([url]) => String(url).endsWith('/send'))).toHaveLength(1)
})
