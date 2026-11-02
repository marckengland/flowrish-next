import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), create: vi.fn(), origin: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/rehearsal-faq', () => ({ createRehearsalFaq: mocks.create, getRehearsalFaqOrigin: mocks.origin }))
import { POST } from './route'
import { GET } from '@/app/api/knowledge/[id]/rehearsal/route'
const id = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ id }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } }) })
describe('rehearsal FAQ routes', () => {
  it('passes only session identity and validated route identity and disables caching', async () => {
    const input = { messageIndex: 1, expectedUpdatedAt: '2026-11-02T00:00:00.000Z' }
    mocks.create.mockResolvedValue({ documentId: id, knowledgeUrl: `/knowledge?document=${id}`, created: true })
    mocks.origin.mockResolvedValue(null)
    const saved = await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(input) }), params)
    expect(saved.status).toBe(200); expect(saved.headers.get('cache-control')).toBe('no-store')
    expect(mocks.create).toHaveBeenCalledWith('session-org', 'admin', id, input)
    const origin = await GET(new Request('http://localhost'), params)
    expect(origin.status).toBe(200); expect(origin.headers.get('cache-control')).toBe('no-store')
    expect(await origin.json()).toEqual({ data: null })
    expect(mocks.origin).toHaveBeenCalledWith('session-org', 'admin', id)
  })
  it('requires authentication/permission before body parsing or service reads', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET(new Request('http://localhost'), params)).status).toBe(401)
    mocks.permission.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) })
    expect((await POST(new Request('http://localhost', { method: 'POST', body: 'invalid' }), params)).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.origin).not.toHaveBeenCalled()
  })
  it('rejects oversized/malformed bodies and preserves stale-review conflicts', async () => {
    expect((await POST(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(110 * 1024) }), params)).status).toBe(413)
    expect((await POST(new Request('http://localhost', { method: 'POST', body: 'invalid JSON' }), params)).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.create.mockRejectedValue(new AppError('REHEARSAL_CONFLICT', 'Reload the rehearsal.', 409))
    expect((await POST(new Request('http://localhost', { method: 'POST', body: '{}' }), params)).status).toBe(409)
  })
})
