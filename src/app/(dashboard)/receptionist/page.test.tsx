import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import { homeFixture } from '@/components/receptionist/home-fixture.test-data'
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/db/client', () => ({ prisma: { $queryRaw: mocks.query } }))
import ReceptionistPage from './page'
const fetch = vi.fn()
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user', teamMemberships: [{ team: { organizationId: 'foreign-org' }, role: { permissions: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ key })) } }] } }); mocks.query.mockResolvedValue([{ userId: 'local-user', admin: false, crm: false }]); fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: homeFixture() }) }); vi.stubGlobal('fetch', fetch) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Receptionist home server page gate', () => {
  it('denies foreign-only permissions before mounting the client or reading the snapshot', async () => { render(await ReceptionistPage()); expect(screen.getByRole('alert')).toHaveTextContent('Settings or CRM permissions'); expect(screen.queryByRole('button', { name: 'Refresh receptionist home' })).toBeNull(); expect(fetch).not.toHaveBeenCalled(); expect(mocks.query.mock.calls[0][1].values).toContain('local-org'); expect(mocks.query.mock.calls[0][1].values).toContain('local-user') })
  it.each([{ admin: true, crm: false }, { admin: false, crm: true }])('allows fresh local roles admin=$admin crm=$crm despite a stale session', async ({ admin, crm }) => { mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user', teamMemberships: [] } }); mocks.query.mockResolvedValue([{ userId: 'local-user', admin, crm }]); fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: homeFixture(admin, crm) }) }); render(await ReceptionistPage()); expect(await screen.findByRole('heading', { name: admin ? 'Sample Repairs' : 'Sample Organization' })).toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce() })
  it('denies removed membership and propagates genuine database failures', async () => { mocks.query.mockResolvedValueOnce([]); render(await ReceptionistPage()); expect(screen.getByRole('alert')).toHaveTextContent('Settings or CRM permissions'); const failure = new Error('Synthetic database failure'); mocks.query.mockRejectedValueOnce(failure); await expect(ReceptionistPage()).rejects.toBe(failure); expect(fetch).not.toHaveBeenCalled() })
  it('requires authentication before checking organization roles', async () => { const failure = new AppError('UNAUTHORIZED', 'Authentication required', 401); mocks.session.mockRejectedValueOnce(failure); await expect(ReceptionistPage()).rejects.toBe(failure); expect(mocks.query).not.toHaveBeenCalled() })
})
