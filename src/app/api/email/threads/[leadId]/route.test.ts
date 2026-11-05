import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), access: vi.fn(), lead: vi.fn(), messages: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: m.access }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ lead: { findFirst: m.lead }, emailMessage: { findMany: m.messages } }) }))
import { GET } from './route'
const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ leadId: id }) }, request = () => new NextRequest(`https://app.example/api/email/threads/${id}`)
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user', email: 'owner@example.invalid' } }); m.access.mockResolvedValue({ deletedAt: null, assignedUserId: 'user' }); m.lead.mockResolvedValue({ id, email: null }); m.messages.mockResolvedValue([{ id: 'message', externalId: 'external', threadId: 'thread', fromEmail: 'archived@example.invalid', toEmail: 'owner@example.invalid', subject: 'Preserved conversation', bodyPreview: 'Synthetic history', sentAt: new Date('2026-11-05T00:00:00.000Z') }]) })
it('returns explicitly linked history even when the retained lead has no email', async () => {
  const response = await GET(request(), context); expect(response.status).toBe(200); expect((await response.json()).data[0].messages[0].subject).toBe('Preserved conversation'); expect(m.messages.mock.calls[0][0].where).toMatchObject({ organizationId: 'org', OR: expect.arrayContaining([{ activity: { leadId: id, organizationId: 'org' } }]) }); expect(m.lead.mock.calls[0][0].where).toMatchObject({ id, assignedUserId: 'user', deletedAt: null })
})
it('includes retained-address matching together with scoped linked history for different archived addresses', async () => {
  m.lead.mockResolvedValue({ id, email: 'Keeper@Example.Invalid' }); expect((await GET(request(), context)).status).toBe(200); expect(m.messages.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ fromEmail: { equals: 'keeper@example.invalid', mode: 'insensitive' } }, { toEmail: { equals: 'keeper@example.invalid', mode: 'insensitive' } }, { activity: { leadId: id, organizationId: 'org' } }]))
})
it('does not query messages for an inaccessible lead', async () => { m.lead.mockResolvedValue(null); expect((await GET(request(), context)).status).toBe(404); expect(m.messages).not.toHaveBeenCalled() })
