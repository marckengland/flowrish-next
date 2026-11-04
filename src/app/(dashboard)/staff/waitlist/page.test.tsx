import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), grant: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/waitlist-staff', () => ({
  assertWaitlistStaff: mocks.grant,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
import Page from './page'
import { StaffWaitlistInbox } from '@/components/admin/staff-waitlist-inbox'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({
    organizationId: 'org',
    dbUser: { id: 'staff' },
  })
  mocks.grant.mockResolvedValue(undefined)
})
it('checks session organization and staff grant before rendering the inbox', async () => {
  expect((await Page()).type).toBe(StaffWaitlistInbox)
  expect(mocks.grant).toHaveBeenCalledWith('org', 'staff')
})
it('does not render an inbox for a customer admin without a grant', async () => {
  mocks.grant.mockRejectedValue(
    new AppError('FORBIDDEN', 'Staff required', 403),
  )
  await expect(Page()).rejects.toThrow('NEXT_NOT_FOUND')
})
it('does not look up grants for unauthenticated visitors', async () => {
  mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in', 401))
  await expect(Page()).rejects.toMatchObject({ statusCode: 401 })
  expect(mocks.grant).not.toHaveBeenCalled()
})
