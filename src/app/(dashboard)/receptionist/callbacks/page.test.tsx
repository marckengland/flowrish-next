import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), fetch: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/db/client', () => ({ prisma: { $queryRaw: mocks.query } }))
import ReceptionistCallbacksPage from './page'
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user', teamMemberships: [{ team: { organizationId: 'foreign-org' }, role: { permissions: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ key })) } }] } }); mocks.query.mockResolvedValue([{ userId: 'local-user', admin: false, crm: false }]) })

describe('Receptionist callback inbox server guard', () => {
  it.each([{ admin: false, crm: false }, { admin: false, crm: true }])('denies foreign-only or CRM-only roles before mounting the inbox: crm=$crm', async ({ admin, crm }) => {
    mocks.query.mockResolvedValue([{ userId: 'local-user', admin, crm }]); render(await ReceptionistCallbacksPage())
    expect(screen.getByRole('alert')).toHaveTextContent('Organization administrator access'); expect(screen.queryByRole('button', { name: 'Load callback requests' })).toBeNull(); expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls[0][1].values).toContain('local-org'); expect(mocks.query.mock.calls[0][1].values).toContain('local-user')
  })
  it.each([false, true])('uses fresh local Settings permission despite stale session roles: crm=%s', async crm => {
    mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user', teamMemberships: [] } }); mocks.query.mockResolvedValue([{ userId: 'local-user', admin: true, crm }]); render(await ReceptionistCallbacksPage())
    expect(screen.getByRole('heading', { name: 'Receptionist callback inbox', level: 1 })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Load callback requests' })).toBeEnabled(); expect(screen.queryByRole('button', { name: 'Load website receptionist settings' })).toBeNull(); expect(screen.getByRole('link', { name: 'Receptionist home' })).toHaveAttribute('href', '/receptionist'); expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('denies removed membership and propagates genuine database failures', async () => {
    mocks.query.mockResolvedValueOnce([]); render(await ReceptionistCallbacksPage()); expect(screen.getByRole('alert')).toHaveTextContent('Organization administrator access'); const failure = new Error('Synthetic DB failure'); mocks.query.mockRejectedValueOnce(failure); await expect(ReceptionistCallbacksPage()).rejects.toBe(failure); expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('requires authentication before checking local roles', async () => {
    const failure = new AppError('UNAUTHORIZED', 'Sign in required', 401); mocks.session.mockRejectedValueOnce(failure); await expect(ReceptionistCallbacksPage()).rejects.toBe(failure); expect(mocks.query).not.toHaveBeenCalled()
  })
})
