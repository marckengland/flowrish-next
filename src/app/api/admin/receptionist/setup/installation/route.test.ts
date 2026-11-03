import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), check: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/receptionist-installation', () => ({ checkReceptionistInstallation: mocks.check }))
import { POST } from './route'
const url = 'https://customer.example.com/', expectedUpdatedAt = '2026-11-03T00:00:00.000Z'
function request(body: unknown = { url, expectedUpdatedAt }, origin = 'https://flowrish.example.com') { return new Request('https://flowrish.example.com/api/admin/receptionist/setup/installation', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user' } }); mocks.check.mockResolvedValue({ outcome: 'snippet_missing' }) })
describe('installation HTTP boundary', () => {
  it('uses session scope, deployment origin and request cancellation with no-store output', async () => {
    const req = request(), response = await POST(req); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.check).toHaveBeenCalledWith('local-org', 'local-user', { url, expectedUpdatedAt }, 'https://flowrish.example.com', req.signal)
  })
  it('rejects cross-origin, oversized, unknown or unsafe inputs before outbound work', async () => {
    for (const req of [request(undefined, 'https://foreign.example.com'), request({ url: 'http://localhost', expectedUpdatedAt }), request({ url, expectedUpdatedAt, organizationId: 'foreign' }), request({ url: 'x'.repeat(9000), expectedUpdatedAt })]) { const response = await POST(req); expect([400, 403, 413]).toContain(response.status); expect(response.headers.get('cache-control')).toBe('no-store') } expect(mocks.check).not.toHaveBeenCalled()
  })
  it('retains authentication, authorization, conflict and rate-limit statuses safely', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Authentication required', 401)); expect((await POST(request())).status).toBe(401)
    for (const status of [403, 409, 429]) { mocks.check.mockRejectedValueOnce(new AppError('CHECK_UNAVAILABLE', 'Safe message', status)); const response = await POST(request()); expect(response.status).toBe(status); if (status === 429) expect(response.headers.get('retry-after')).toBe('30') }
    mocks.check.mockRejectedValueOnce(new Error('PRIVATE DNS/KEY DETAILS')); const response = await POST(request()); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/PRIVATE|DNS\/KEY/)
  })
})
