import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), find: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: mocks.user } }),
}))
vi.mock('@/server/db/client', () => ({
  prisma: { user: { findUnique: mocks.find } },
}))
import { getPilotIdentity } from '../pilot-identity'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.find.mockResolvedValue({ id: 'synthetic-user' })
})
it('uses a verified auth email and immutable auth identity, not editable metadata', async () => {
  mocks.user.mockResolvedValue({
    data: {
      user: {
        id: 'auth-user',
        email: ' PROSPECT@example.test ',
        email_confirmed_at: '2026-11-04T00:00:00Z',
        user_metadata: { email: 'different@example.test' },
      },
    },
    error: null,
  })
  expect(await getPilotIdentity()).toEqual({
    userId: 'synthetic-user',
    email: 'prospect@example.test',
    verified: true,
  })
  expect(mocks.find).toHaveBeenCalledWith({
    where: { authId: 'auth-user' },
    select: { id: true },
  })
})
it('does not trust a profile claim that an email is verified', async () => {
  mocks.user.mockResolvedValue({
    data: {
      user: {
        id: 'auth-user',
        email: 'prospect@example.test',
        user_metadata: { email_verified: true },
      },
    },
    error: null,
  })
  expect(await getPilotIdentity()).toBeNull()
  expect(mocks.find).not.toHaveBeenCalled()
})
