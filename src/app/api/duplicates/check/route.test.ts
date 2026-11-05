import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), access: vi.fn(), lead: vi.fn(), check: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: m.access }))
vi.mock('@/server/db/client', () => ({ prisma: { lead: { findFirst: m.lead } } }))
vi.mock('@/server/services/duplicates', () => ({ checkDuplicates: m.check }))
import { POST } from './route'
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
function request(body: unknown) { return new Request('https://app.example/api/duplicates/check', { method: 'POST', headers: { origin: 'https://app.example', 'content-type': 'application/json', 'x-flowrish-merge-user': 'user' }, body: JSON.stringify(body) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); m.access.mockResolvedValue({ deletedAt: null, assignedUserId: 'user' }); m.lead.mockResolvedValue({ id, email: 'practice@example.invalid', companyName: 'Practice' }); m.check.mockResolvedValue([{ leadId: id }, { leadId: other }]) })
it('derives search values from an accessible source and scopes every candidate to the caller', async () => {
  const response = await POST(request({ leadId: id })); expect(response.status).toBe(200); expect((await response.json()).data).toEqual([{ leadId: other }]); expect(m.lead.mock.calls[0][0].where).toMatchObject({ id, organizationId: 'org', assignedUserId: 'user' }); expect(m.check).toHaveBeenCalledWith('practice@example.invalid', 'Practice', 'org', { deletedAt: null, assignedUserId: 'user' }); expect(m.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:read'); expect(m.permission).not.toHaveBeenCalledWith(expect.anything(), 'leads:delete')
})
it('rejects inaccessible sources and arbitrary search values without exposing matches', async () => {
  m.lead.mockResolvedValue(null); const response = await POST(request({ leadId: id })); expect(response.status).toBe(404); expect(await response.text()).not.toContain('practice@example.invalid'); expect((await POST(request({ leadId: id, contactEmail: 'other@example.invalid' }))).status).toBe(400); expect(m.check).not.toHaveBeenCalled()
})
