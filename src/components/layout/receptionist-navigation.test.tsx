import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { useLayoutStore } from '@/stores/layout'
import type { Permission } from '@/types/permissions'

const route = vi.hoisted(() => ({ pathname: '/receptionist' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowser: () => ({ auth: { signOut: vi.fn() } }) }))
vi.mock('@/components/notifications/notification-bell', () => ({ NotificationBell: () => null }))
const user = { name: 'Sample member', email: 'member@example.test' }
beforeEach(() => { route.pathname = '/receptionist'; useLayoutStore.setState({ mobileNavOpen: false, chatOpen: false }) })

describe('Receptionist navigation', () => {
  it.each<Permission[]>([[], ['leads:read'], ['leads:write']])('requires Settings or both CRM permissions: %j', (...permissions) => {
    render(<Sidebar permissions={permissions} user={user} />)
    expect(screen.queryByRole('link', { name: 'Receptionist' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument()
  })
  it.each<{ permissions: Permission[] }>([{ permissions: ['admin:settings'] }, { permissions: ['leads:read', 'leads:write'] }])('shows a current Receptionist link for $permissions', ({ permissions }) => {
    route.pathname = '/receptionist/setup'; render(<Sidebar permissions={permissions} user={user} />)
    expect(screen.getByRole('link', { name: 'Receptionist' })).toHaveAttribute('href', '/receptionist')
    expect(screen.getByRole('link', { name: 'Receptionist' })).toHaveAttribute('aria-current', 'page')
    expect(!!screen.queryByRole('link', { name: 'Settings' })).toBe(permissions.includes('admin:settings'))
  })
  it.each(['cadences:read', 'cadences:manage'] satisfies Permission[])('retains the existing any-of Cadences permission: %s', permission => {
    render(<Sidebar permissions={[permission]} user={user} />); expect(screen.getByRole('link', { name: 'Cadences' })).toBeInTheDocument()
  })
  it.each([{ pathname: '/receptionist', title: 'Receptionist' }, { pathname: '/receptionist/setup', title: 'Receptionist setup' }])('labels $pathname distinctly', ({ pathname, title }) => {
    route.pathname = pathname; render(<Header user={user} organizationName="Sample org" />)
    expect(screen.getByText(title, { exact: true })).toBeInTheDocument()
  })
})
