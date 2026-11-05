import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), list: vi.fn(), review: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/follow-ups', () => ({ listFollowUps: mocks.list, reviewFollowUp: mocks.review }))
import { GET } from './route'
import { PATCH } from './[id]/route'
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); mocks.list.mockResolvedValue({ items: [{ id: 'item', lead: { id: 'lead' } }], canWrite: true }); mocks.review.mockResolvedValue({ id: 'item', status: 'APPROVED', lead: { id: 'lead' } }) })
describe('follow-up API access', () => {
  it('uses the server session to scope the inbox', async () => {
    const response = await GET(new NextRequest('https://example.com/api/follow-ups?status=APPROVED&organizationId=other', { headers: { 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'user']) } }))
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith('org', 'user', 'APPROVED')
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:read')
  })
  it('rejects unauthenticated inbox reads', async () => {
    mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET(new NextRequest('https://example.com/api/follow-ups'))).status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('rejects approval without write permission', async () => {
    mocks.permission.mockImplementation((_user, permission) => { if (permission === 'leads:write') throw new AppError('FORBIDDEN', 'Permission denied', 403) })
    const response = await PATCH(new NextRequest('https://example.com/api/follow-ups/item', { method: 'PATCH', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'user']) }, body: JSON.stringify({ action: 'approve' }) }), { params: Promise.resolve({ id: 'item' }) })
    expect(response.status).toBe(403)
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('approves with scoped identity and returns the item with its lead', async () => {
    const response = await PATCH(new NextRequest('https://example.com/api/follow-ups/item', { method: 'PATCH', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'user']) }, body: JSON.stringify({ action: 'approve', title: 'Call tomorrow' }) }), { params: Promise.resolve({ id: 'item' }) })
    expect(response.status).toBe(200)
    expect(mocks.review).toHaveBeenCalledWith('org', 'user', 'item', { action: 'approve', title: 'Call tomorrow' })
    expect((await response.json()).data.lead.id).toBe('lead')
  })
})
