import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), list: vi.fn(), create: vi.fn(), get: vi.fn(), review: vi.fn(), remove: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/receptionist-rehearsals', () => ({ listRehearsals: mocks.list, createRehearsal: mocks.create, getRehearsal: mocks.get, reviewRehearsal: mocks.review, deleteRehearsal: mocks.remove }))
import { GET, POST } from './route'
import { GET as DETAIL, PATCH, DELETE } from './[id]/route'

const id = '11111111-1111-4111-8111-111111111111'
const context = { params: Promise.resolve({ id }) }
const request = (method: string, body?: string) => new NextRequest('http://localhost/api/admin/receptionist/rehearsals', { method, ...(body === undefined ? {} : { body }) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } })
})
describe('rehearsal report API', () => {
  it('uses session identity and no-store responses on all operations', async () => {
    mocks.list.mockResolvedValue([])
    mocks.create.mockResolvedValue({ id })
    mocks.get.mockResolvedValue({ id })
    mocks.review.mockResolvedValue({ id })
    mocks.remove.mockResolvedValue({ deleted: true })
    const responses = [await GET(), await POST(request('POST', '{"title":"Synthetic"}')), await DETAIL(request('GET'), context), await PATCH(request('PATCH', '{"verdict":"passed"}'), context), await DELETE(request('DELETE'), context)]
    for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.list).toHaveBeenCalledWith('session-org', 'admin')
    expect(mocks.create).toHaveBeenCalledWith('session-org', 'admin', { title: 'Synthetic' })
    expect(mocks.get).toHaveBeenCalledWith('session-org', 'admin', id)
    expect(mocks.review).toHaveBeenCalledWith('session-org', 'admin', id, { verdict: 'passed' })
    expect(mocks.remove).toHaveBeenCalledWith('session-org', 'admin', id)
  })
  it('rejects authentication and authorization before reading a body or report', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET()).status).toBe(401)
    mocks.permission.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) })
    expect((await POST(request('POST', 'malformed'))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects malformed and oversized streamed bodies before service writes', async () => {
    expect((await POST(request('POST', 'not JSON'))).status).toBe(400)
    expect((await POST(request('POST', 'x'.repeat(110 * 1024)))).status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('preserves known errors and hides unexpected failures', async () => {
    mocks.get.mockRejectedValueOnce(new AppError('REHEARSAL_NOT_FOUND', 'Rehearsal report not found.', 404))
    expect((await DETAIL(request('GET'), context)).status).toBe(404)
    mocks.list.mockRejectedValueOnce(new Error('private database details'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'REHEARSAL_UNAVAILABLE', message: 'Rehearsal reports are unavailable. Please try again.' } })
  })
})
