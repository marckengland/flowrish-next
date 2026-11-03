import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const { session, report } = vi.hoisted(() => ({ session: vi.fn(), report: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: session }))
vi.mock('@/server/services/callback-performance', () => ({ getCallbackPerformance: report }))
import { GET } from './route'
const request = (query = 'from=2026-11-01&to=2026-11-03') => new Request(`https://app.example/api/callback-performance?${query}`)
beforeEach(() => { vi.clearAllMocks(); session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user' } }); report.mockResolvedValue({ counts: { requests: 0 } }) })
describe('read-only performance HTTP boundary', () => {
  it('uses the authenticated organization and never caches its report', async () => {
    const response = await GET(request()); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(report).toHaveBeenCalledWith('local-org', 'local-user', { from: '2026-11-01', to: '2026-11-03', owner: 'all', bucket: 'all', page: 1 })
  })
  it('rejects forged organizations, duplicate values, impossible dates and oversized queries before querying data', async () => {
    for (const query of ['organizationId=foreign&from=2026-11-01&to=2026-11-03', 'from=2026-11-01&from=2026-11-02&to=2026-11-03', 'from=2026-02-30&to=2026-03-01', `from=${'x'.repeat(600)}`, 'from=2026-11-01&to=2026-11-03&bucket=made-up']) { const response = await GET(request(query)); expect(response.status).toBe(400); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(report).not.toHaveBeenCalled()
  })
  it('retains authentication/permission statuses and hides internal diagnostics', async () => {
    session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Authentication required', 401)); expect((await GET(request())).status).toBe(401)
    report.mockRejectedValueOnce(new AppError('FORBIDDEN', 'Forbidden', 403)); expect((await GET(request())).status).toBe(403)
    report.mockRejectedValueOnce(new Error('PRIVATE DATABASE HOST/API KEY')); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/PRIVATE|API KEY|DATABASE HOST/); expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
