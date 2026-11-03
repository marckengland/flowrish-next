import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), home: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/receptionist-home', () => ({ getReceptionistHome: mocks.home }))
import { GET } from './route'
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user' } }); mocks.home.mockResolvedValue({ asOf: '2026-11-03T12:00:00.000Z' }) })
describe('receptionist home HTTP boundary', () => {
  it('uses session organization/user and never caches the private snapshot', async () => { const response = await GET(new Request('https://app.example/api/receptionist/home')); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.home).toHaveBeenCalledWith('local-org', 'local-user') })
  it('rejects caller-selected organization or unsupported query values before reading metadata', async () => { for (const query of ['organizationId=foreign', 'userId=foreign', 'refresh=true', 'x=1&x=2']) expect((await GET(new Request(`https://app.example/api/receptionist/home?${query}`))).status).toBe(400); expect(mocks.home).not.toHaveBeenCalled() })
  it('preserves authentication/permission failures and hides internal diagnostics', async () => { mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Authentication required', 401)); expect((await GET(new Request('https://app.example/api/receptionist/home'))).status).toBe(401); mocks.home.mockRejectedValueOnce(new AppError('FORBIDDEN', 'Forbidden', 403)); expect((await GET(new Request('https://app.example/api/receptionist/home'))).status).toBe(403); mocks.home.mockRejectedValueOnce(new Error('PRIVATE DATABASE/API KEY')); const response = await GET(new Request('https://app.example/api/receptionist/home')); expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.text()).not.toContain('PRIVATE') })
})
