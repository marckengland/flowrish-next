import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), get: vi.fn(), business: vi.fn(), launch: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/receptionist-setup', () => ({ getReceptionistSetup: mocks.get, saveReceptionistSetupBusiness: mocks.business, launchReceptionistSetup: mocks.launch }))
import { GET } from './route'
import { PATCH } from './business/route'
import { POST } from './launch/route'
const request = (body = '{}', origin = 'https://app.example') => new Request('https://app.example/api/setup', { method: 'POST', headers: { origin }, body })
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } }) })
describe('guided receptionist setup API', () => {
  it('scopes every operation to authenticated organization and user with no-store responses', async () => {
    for (const result of [await GET(), await PATCH(request('{"values":{}}')), await POST(request('{"acknowledged":true}'))]) { expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.get).toHaveBeenCalledWith('session-org', 'admin'); expect(mocks.business).toHaveBeenCalledWith('session-org', 'admin', { values: {} }); expect(mocks.launch).toHaveBeenCalledWith('session-org', 'admin', { acknowledged: true }); expect(mocks.permission).toHaveBeenCalledTimes(3)
  })
  it('requires admin/authentication, same-origin writes, bounded valid JSON and preserves conflicts', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET()).status).toBe(401)
    mocks.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) }); expect((await GET()).status).toBe(403)
    for (const origin of ['', 'null', 'https://evil.example']) expect((await POST(request('{}', origin))).status).toBe(403)
    expect((await PATCH(request('bad JSON'))).status).toBe(400); expect((await PATCH(request('x'.repeat(9000)))).status).toBe(413); expect(mocks.launch).not.toHaveBeenCalled(); expect(mocks.business).not.toHaveBeenCalled()
    mocks.launch.mockRejectedValue(new AppError('SETUP_CONFLICT', 'Reload', 409)); expect((await POST(request())).status).toBe(409)
    mocks.get.mockRejectedValue(new Error('private SQL diagnostic')); const result = await GET(); expect(result.status).toBe(503); expect(await result.text()).not.toContain('SQL')
  })
})
