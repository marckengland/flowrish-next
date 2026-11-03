import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import { performanceFixture } from '@/components/callbacks/performance-fixture.test-data'

const { session, query } = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: session }))
vi.mock('@/server/db/client', () => ({ prisma: { $queryRaw: query } }))
import ReceptionistPerformancePage from './page'

const org = 'active-organization', user = 'current-user', full = ['admin:settings', 'leads:read', 'leads:write'], fetch = vi.fn()
const membership = (organizationId: string, keys: string[]) => ({ team: { organizationId }, role: { permissions: keys.map(key => ({ key })) } })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-03T12:00:00Z'))
  vi.clearAllMocks(); session.mockResolvedValue({ organizationId: org, dbUser: { id: user, teamMemberships: [membership('foreign-organization', full)] } }); query.mockResolvedValue([{ userId: user, admin: false, crm: false }]); fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: performanceFixture() }) }); vi.stubGlobal('fetch', fetch)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('performance page checks current organization access before mounting the report', () => {
  it.each([
    { local: [], foreign: full, admin: false, crm: false },
    { local: ['admin:settings'], foreign: ['leads:read', 'leads:write'], admin: true, crm: false },
    { local: ['leads:read', 'leads:write'], foreign: ['admin:settings'], admin: false, crm: true },
  ])('denies a combined session permission union when local access is admin=$admin crm=$crm', async ({ local, foreign, admin, crm }) => {
    session.mockResolvedValue({ organizationId: org, dbUser: { id: user, teamMemberships: [membership(org, local), membership('foreign-organization', foreign)] } }); query.mockResolvedValue([{ userId: user, admin, crm }])
    render(await ReceptionistPerformancePage())
    expect(screen.getByRole('alert')).toHaveTextContent('Settings and CRM permissions are required to view this report.')
    expect(screen.queryByRole('form', { name: 'Performance filters' })).toBeNull(); expect(screen.queryByText('Loading receptionist performance…')).toBeNull(); expect(fetch).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledOnce(); expect(query.mock.calls[0][1].values).toContain(org); expect(query.mock.calls[0][1].values).toContain(user)
  })
  it('recognizes freshly granted local permissions even when the session role list is stale', async () => {
    session.mockResolvedValue({ organizationId: org, dbUser: { id: user, teamMemberships: [] } }); query.mockResolvedValue([{ userId: user, admin: true, crm: true }]); render(await ReceptionistPerformancePage())
    expect(await screen.findByRole('button', { name: 'Available requests: 4' })).toBeInTheDocument(); expect(screen.getByRole('form', { name: 'Performance filters' })).toBeInTheDocument(); expect(screen.queryByRole('alert')).toBeNull(); expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][0]).toContain('/api/callback-performance?')
  })
  it('denies removed membership immediately despite cached session permissions', async () => {
    session.mockResolvedValue({ organizationId: org, dbUser: { id: user, teamMemberships: [membership(org, full)] } }); query.mockResolvedValue([]); render(await ReceptionistPerformancePage()); expect(screen.getByRole('alert')).toHaveTextContent('Settings and CRM permissions are required'); expect(screen.queryByRole('form', { name: 'Performance filters' })).toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
  it('propagates database failures instead of misreporting a permission denial', async () => {
    const failure = new Error('Synthetic access query failure'); query.mockRejectedValue(failure); await expect(ReceptionistPerformancePage()).rejects.toBe(failure); expect(fetch).not.toHaveBeenCalled()
  })
  it('requires authentication before querying access or mounting the client', async () => {
    const failure = new AppError('UNAUTHORIZED', 'Authentication required', 401); session.mockRejectedValue(failure); await expect(ReceptionistPerformancePage()).rejects.toBe(failure); expect(query).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
  })
})
