import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), get: vi.fn(), save: vi.fn(), list: vi.fn(), review: vi.fn(), remove: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/website-receptionist', () => ({ getWebsiteReceptionistAdmin: mocks.get, saveWebsiteReceptionist: mocks.save, listWebsiteCallbacks: mocks.list, reviewWebsiteCallback: mocks.review, deleteWebsiteCallback: mocks.remove }))
import { GET, PUT } from './route'
import { GET as LIST } from './callbacks/route'
import { PATCH, DELETE } from './callbacks/[id]/route'
const context = { params: Promise.resolve({ id: 'callback' }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } }) })
describe('website receptionist administration routes', () => {
  it('requires admin identity and passes body/query to strict service validation', async () => {
    const body = { enabled: false, organizationId: 'untrusted' }
    for (const response of [await GET(), await PUT(new Request('http://localhost', { method: 'PUT', body: JSON.stringify(body) })), await LIST(new Request('http://localhost/?status=pending&page=2')), await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{"action":"review"}' }), context), await DELETE(new Request('http://localhost', { method: 'DELETE' }), context)]) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.get).toHaveBeenCalledWith('session-org', 'admin'); expect(mocks.save).toHaveBeenCalledWith('session-org', 'admin', body); expect(mocks.list).toHaveBeenCalledWith('session-org', 'admin', { status: 'pending', page: '2' }); expect(mocks.review).toHaveBeenCalledWith('session-org', 'admin', 'callback', { action: 'review' }); expect(mocks.remove).toHaveBeenCalledWith('session-org', 'admin', 'callback'); expect(mocks.permission).toHaveBeenCalledTimes(5)
  })
  it('rejects unauthorized, malformed, oversized and duplicate inputs', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET()).status).toBe(401)
    mocks.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'No access', 403) }); expect((await GET()).status).toBe(403)
    expect((await PUT(new Request('http://localhost', { method: 'PUT', body: 'bad' }))).status).toBe(400)
    expect((await PUT(new Request('http://localhost', { method: 'PUT', body: 'x'.repeat(9000) }))).status).toBe(413)
    expect((await LIST(new Request('http://localhost/?page=1&page=2'))).status).toBe(400)
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled()
    mocks.review.mockRejectedValue(new AppError('WEBSITE_CONFLICT', 'Reload', 409)); expect((await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{}' }), context)).status).toBe(409)
  })
})
