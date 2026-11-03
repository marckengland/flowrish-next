import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), query: vi.fn(), fetch: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session })); vi.mock('@/server/db/client', () => ({ prisma: { $queryRaw: mocks.query } }))
import VisitorFeedbackPage from './page'
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', mocks.fetch); mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user', teamMemberships: [] } }); mocks.query.mockResolvedValue([{ userId: 'local-user', admin: false, crm: true }]) })
describe('visitor feedback server page', () => {
  it('denies CRM-only or foreign roles before mounting the private inbox', async () => { render(await VisitorFeedbackPage()); expect(screen.getByRole('alert')).toHaveTextContent('Organization administrator access'); expect(screen.queryByRole('button', { name: 'Load visitor feedback' })).toBeNull(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.query.mock.calls[0][1].values).toContain('local-org'); expect(mocks.query.mock.calls[0][1].values).toContain('local-user') })
  it('allows fresh local Settings roles with no stale session grants and no automatic reads', async () => { mocks.query.mockResolvedValue([{ userId: 'local-user', admin: true, crm: false }]); render(await VisitorFeedbackPage()); expect(screen.getByRole('button', { name: 'Load visitor feedback' })).toBeEnabled(); expect(screen.getByRole('link', { name: 'Receptionist home' })).toHaveAttribute('href', '/receptionist'); expect(mocks.fetch).not.toHaveBeenCalled() })
  it('denies removed membership and propagates authentication/database failures', async () => { mocks.query.mockResolvedValueOnce([]); render(await VisitorFeedbackPage()); expect(screen.getByRole('alert')).toHaveTextContent('Organization administrator access'); const unavailable = new Error('Synthetic database failure'); mocks.query.mockRejectedValueOnce(unavailable); await expect(VisitorFeedbackPage()).rejects.toBe(unavailable); const unauthenticated = new AppError('UNAUTHORIZED', 'Sign in', 401); mocks.session.mockRejectedValueOnce(unauthenticated); await expect(VisitorFeedbackPage()).rejects.toBe(unauthenticated) })
})
