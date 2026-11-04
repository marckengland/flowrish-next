import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  team: vi.fn(),
  role: vi.fn(),
  member: vi.fn(),
  create: vi.fn(),
  organization: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ getSession: mocks.session }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/server/db/client', () => ({
  prisma: {
    team: { findFirst: mocks.team },
    role: { findFirst: mocks.role },
    teamMember: { findUnique: mocks.member, create: mocks.create },
    organization: { findUnique: mocks.organization },
  },
}))
vi.mock('@/components/layout/shell', () => ({
  Shell: ({
    permissions,
    children,
  }: {
    permissions: string[]
    children: React.ReactNode
  }) => (
    <div>
      <p>Permissions: {permissions.join(',') || 'none'}</p>
      {children}
    </div>
  ),
}))
import DashboardLayout from '@/app/(dashboard)/layout'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.team.mockResolvedValue({ id: 'general' })
  mocks.role.mockResolvedValue({ id: 'owner' })
  mocks.member.mockResolvedValue(null)
  mocks.organization.mockResolvedValue({ name: 'Practice' })
  mocks.session.mockResolvedValue({
    organizationId: 'current',
    dbUser: {
      id: 'user',
      name: 'Practice',
      email: 'practice@example.test',
      teamMemberships: [],
    },
  })
})
afterEach(cleanup)
it('never grants an OWNER role or redirects to retry when viewing with no active permissions', async () => {
  render(await DashboardLayout({ children: <p>Content</p> }))
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.team).not.toHaveBeenCalled()
  expect(mocks.role).not.toHaveBeenCalled()
  expect(mocks.redirect).not.toHaveBeenCalled()
  expect(screen.getByText('Permissions: none')).toBeInTheDocument()
})
it('ignores unrelated organization roles in the navigation permission set', async () => {
  mocks.session.mockResolvedValue({
    organizationId: 'current',
    dbUser: {
      id: 'user',
      teamMemberships: [
        {
          team: { organizationId: 'other' },
          role: { permissions: [{ key: 'admin:settings' }] },
        },
      ],
    },
  })
  render(await DashboardLayout({ children: <p>Content</p> }))
  expect(mocks.create).not.toHaveBeenCalled()
  expect(screen.getByText('Permissions: none')).toBeInTheDocument()
})
