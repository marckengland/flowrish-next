import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), save: vi.fn(), list: vi.fn(), count: vi.fn(), notices: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/callback-response', () => ({ getCallbackResponsePolicy: mocks.get, saveCallbackResponsePolicy: mocks.save, listCallbackResponseTargets: mocks.list }))
vi.mock('@/server/services/callback-notifications', () => ({ getCallbackNotificationCount: mocks.count, listCallbackNotifications: mocks.notices }))
import { GET, PUT } from './route'
import { GET as QUEUE } from '../../callback-response-targets/route'
import { GET as COUNT } from '../../callback-notifications/count/route'
import { GET as NOTICES } from '../../callback-notifications/route'
const body = { enabled: true, handoffMinutes: 60, attemptMinutes: 120, backupUserId: '11111111-1111-4111-8111-111111111111', expectedUpdatedAt: null, expectedBusinessUpdatedAt: null, acknowledged: true }
function request(value = JSON.stringify(body), origin = 'https://app.example') { return new Request('https://app.example/api/admin/callback-response-policy', { method: 'PUT', headers: { origin }, body: value }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'session-user' } }) })
describe('callback response routes', () => {
  it('uses session scope and no-store for policy reads, explicit saves and queue filters', async () => {
    for (const response of [await GET(), await PUT(request()), await QUEUE(new Request('https://app.example/api/callback-response-targets?filter=all&page=2'))]) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.get).toHaveBeenCalledWith('session-org', 'session-user'); expect(mocks.save).toHaveBeenCalledWith('session-org', 'session-user', body); expect(mocks.list).toHaveBeenCalledWith('session-org', 'session-user', { filter: 'all', page: 2 })
  })
  it('rejects unauthenticated, cross-origin, invalid and oversized writes without invoking the service', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET()).status).toBe(401)
    for (const origin of ['', 'null', 'https://evil.example']) expect((await PUT(request(undefined, origin))).status).toBe(403)
    for (const value of ['bad JSON', JSON.stringify({ ...body, acknowledged: false }), JSON.stringify({ ...body, organizationId: 'other' })]) expect((await PUT(request(value))).status).toBe(400)
    expect((await PUT(request('x'.repeat(9000)))).status).toBe(413); for (const query of ['filter=all&filter=missed', 'page=0', 'userId=other']) expect((await QUEUE(new Request(`https://app.example/api/callback-response-targets?${query}`))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled()
  })
  it('preserves permission/conflict errors and hides unknown diagnostics', async () => {
    mocks.get.mockRejectedValueOnce(new AppError('FORBIDDEN', 'Admin only', 403)); expect((await GET()).status).toBe(403); mocks.save.mockRejectedValueOnce(new AppError('RESPONSE_CONFLICT', 'Reload', 409)); expect((await PUT(request())).status).toBe(409); mocks.get.mockRejectedValue(new Error('PRIVATE SQL')); const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE')
  })
  it('keeps cached notification clients on the original feed until they opt into response alerts', async () => {
    const headers = { 'X-Flowrish-Response-Targets': '1' }; await COUNT(); expect(mocks.count).toHaveBeenLastCalledWith('session-org', 'session-user'); await COUNT(new Request('https://app.example/api/callback-notifications/count', { headers })); expect(mocks.count).toHaveBeenLastCalledWith('session-org', 'session-user', true)
    await NOTICES(new Request('https://app.example/api/callback-notifications')); expect(mocks.notices).toHaveBeenLastCalledWith('session-org', 'session-user', { filter: 'unread', page: 1 }); await NOTICES(new Request('https://app.example/api/callback-notifications', { headers })); expect(mocks.notices).toHaveBeenLastCalledWith('session-org', 'session-user', { filter: 'unread', page: 1 }, true)
  })
})
