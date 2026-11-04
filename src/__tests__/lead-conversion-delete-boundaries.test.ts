import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), convert: vi.fn(), remove: vi.fn(), audit: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/services/access', () => ({ getLeadAccessFilter: m.access }))
vi.mock('@/server/services/leads', () => ({ convertToContact: m.convert, softDeleteLead: m.remove, createLead: vi.fn(), updateLead: vi.fn(), getLeadById: vi.fn() }))
vi.mock('@/server/db/middleware', () => ({ createTenantPrisma: () => ({ auditEntry: { create: m.audit } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { POST } from '@/app/api/leads/[id]/convert/route'
import { DELETE } from '@/app/api/leads/[id]/route'
import { convertLead, deleteLead } from '@/server/actions/leads'

const id = '11111111-1111-4111-8111-111111111111'
const scope = { deletedAt: null, assignedUserId: { in: ['self', 'team'] } }
beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'self', teamMemberships: [{ role: { hierarchy: 2, permissions: [{ key: 'leads:write' }, { key: 'leads:delete' }] } }] } })
  m.access.mockResolvedValue(scope)
  m.convert.mockResolvedValue({ lead: { id }, contact: { id: 'contact' } })
  m.remove.mockResolvedValue({ id }); m.audit.mockResolvedValue({})
})
it('passes trusted record scope to conversion and deletion from both APIs and actions', async () => {
  const context = { params: Promise.resolve({ id }) }
  expect((await POST(new NextRequest(`https://example.test/api/leads/${id}/convert`, { method: 'POST' }), context)).status).toBe(201)
  expect((await DELETE(new NextRequest(`https://example.test/api/leads/${id}`, { method: 'DELETE' }), context)).status).toBe(200)
  expect(await convertLead(id)).toHaveProperty('data')
  expect(await deleteLead(id)).toHaveProperty('data')
  expect(m.convert).toHaveBeenCalledTimes(2); expect(m.remove).toHaveBeenCalledTimes(2)
  for (const call of [...m.convert.mock.calls, ...m.remove.mock.calls]) expect(call).toEqual([id, 'self', 'org', scope])
})
it('denies conversion and deletion before any service mutation when the role lacks permission', async () => {
  m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'self', teamMemberships: [] } })
  const context = { params: Promise.resolve({ id }) }
  expect((await POST(new NextRequest(`https://example.test/api/leads/${id}/convert`, { method: 'POST' }), context)).status).toBe(403)
  expect((await DELETE(new NextRequest(`https://example.test/api/leads/${id}`, { method: 'DELETE' }), context)).status).toBe(403)
  await expect(convertLead(id)).rejects.toMatchObject({ statusCode: 403 })
  await expect(deleteLead(id)).rejects.toMatchObject({ statusCode: 403 })
  expect(m.convert).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.access).not.toHaveBeenCalled()
})
