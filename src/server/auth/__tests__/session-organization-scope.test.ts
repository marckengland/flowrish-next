import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: mocks.auth } }),
}))
vi.mock('@/server/db/client', () => ({
  prisma: { user: { findUnique: mocks.user } },
}))
import { getSession } from '../session'
import { hasPermission } from '../permissions'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ data: { user: { id: 'auth' } } })
})
it('keeps only active-organization roles when the same user is an administrator elsewhere', async () => {
  mocks.user.mockResolvedValue({
    id: 'user',
    organizationMemberships: [
      { organizationId: 'current', isDefault: true },
      { organizationId: 'other', isDefault: false },
    ],
    teamMemberships: [
      {
        team: { organizationId: 'current' },
        role: { hierarchy: 3, permissions: [{ key: 'leads:read' }] },
      },
      {
        team: { organizationId: 'other' },
        role: {
          hierarchy: 0,
          permissions: [{ key: 'leads:write' }, { key: 'admin:settings' }],
        },
      },
    ],
  })
  const session = await getSession()
  expect(session?.organizationId).toBe('current')
  expect(session?.dbUser.teamMemberships).toHaveLength(1)
  expect(hasPermission(session!.dbUser, 'leads:read')).toBe(true)
  expect(hasPermission(session!.dbUser, 'leads:write')).toBe(false)
  expect(hasPermission(session!.dbUser, 'admin:settings')).toBe(false)
})
it('uses the fallback organization without inheriting an unrelated role', async () => {
  mocks.user.mockResolvedValue({
    id: 'user',
    organizationMemberships: [{ organizationId: 'fallback', isDefault: false }],
    teamMemberships: [
      {
        team: { organizationId: 'other' },
        role: { hierarchy: 0, permissions: [{ key: 'leads:write' }] },
      },
    ],
  })
  const session = await getSession()
  expect(session?.organizationId).toBe('fallback')
  expect(session?.dbUser.teamMemberships).toEqual([])
})
