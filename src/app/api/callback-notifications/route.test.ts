import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), count: vi.fn(), read: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/callback-notifications', () => ({ listCallbackNotifications: mocks.list, getCallbackNotificationCount: mocks.count, readCallbackNotification: mocks.read }))
import { GET } from './route'
import { GET as COUNT } from './count/route'
import { PATCH } from './[key]/route'
const key = 'a'.repeat(64), params = { params: Promise.resolve({ key }) }
function request(body = '{"read":true}', origin = 'https://app.example') { return new Request('https://app.example/api/callback-notifications', { method: 'PATCH', headers: { origin }, body }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'session-user' } }) })
describe('private callback notification routes', () => {
  it('scopes reads and explicit mark-read to session identity with no-store responses', async () => {
    const responses = [await GET(new Request('https://app.example/api/callback-notifications?filter=all&page=2')), await COUNT(), await PATCH(request(), params)]
    for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.list).toHaveBeenCalledWith('session-org', 'session-user', { filter: 'all', page: 2 }); expect(mocks.count).toHaveBeenCalledWith('session-org', 'session-user'); expect(mocks.read).toHaveBeenCalledWith('session-org', 'session-user', key)
  })
  it('rejects unauthenticated reads, cross-origin writes, invalid/duplicate queries and extra fields', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await COUNT()).status).toBe(401)
    for (const origin of ['', 'null', 'https://other.example']) expect((await PATCH(request(undefined, origin), params)).status).toBe(403)
    for (const query of ['filter=all&filter=unread', 'userId=other', 'page=0', 'filter=invalid', `bad=${'x'.repeat(600)}`]) expect((await GET(new Request(`https://app.example/api/callback-notifications?${query}`))).status).toBe(400)
    for (const body of ['bad JSON', '{"read":false}', '{"read":true,"userId":"other"}']) expect((await PATCH(request(body), params)).status).toBe(400)
    expect((await PATCH(request('x'.repeat(9000)), params)).status).toBe(413); expect((await PATCH(request(), { params: Promise.resolve({ key: 'bad' }) })).status).toBe(400); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled()
  })
  it('preserves inaccessible/expired status and redacts unknown failures', async () => {
    mocks.read.mockRejectedValue(new AppError('NOT_FOUND', 'Unavailable', 404)); expect((await PATCH(request(), params)).status).toBe(404)
    mocks.count.mockRejectedValue(new Error('private SQL diagnostic')); const response = await COUNT(); expect(response.status).toBe(503); expect(await response.text()).not.toContain('SQL')
  })
})
