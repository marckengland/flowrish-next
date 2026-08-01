import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Sidebar, type SidebarUser } from './sidebar'
import { useLayoutStore } from '@/stores/layout'
import type { Permission } from '@/types/permissions'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowser: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  }),
}))

const TEST_USER: SidebarUser = {
  name: 'Maya Kessler',
  email: 'maya@example.com',
  roleLabel: 'RevOps Lead',
}

/**
 * Tests that the Sidebar filters navigation items based on the user's
 * effective permissions (Requirement 3.7). Items without a permission
 * gate are always visible.
 */
function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
  rerender: (next: React.JSX.Element) => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
    rerender: (next) => {
      act(() => {
        root.render(next)
      })
    },
  }
}

function linkLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a'))
    .map((a) => a.textContent?.trim() ?? '')
    .filter((t) => t.length > 0)
}

describe('Sidebar', () => {
  beforeEach(() => {
    useLayoutStore.setState({ sidebarCollapsed: false, chatOpen: false })
  })

  it('shows ungated items (Dashboard, Tasks, Rhythm) to any user', () => {
    const { container, unmount } = mount(
      <Sidebar permissions={[]} user={TEST_USER} />,
    )
    const labels = linkLabels(container)

    expect(labels).toContain('Dashboard')
    expect(labels).toContain('Tasks')
    expect(labels).toContain('Rhythm')
    unmount()
  })

  it('hides Settings when user lacks admin:settings', () => {
    const { container, unmount } = mount(
      <Sidebar
        permissions={['leads:read'] satisfies Permission[]}
        user={TEST_USER}
      />,
    )
    expect(linkLabels(container)).not.toContain('Settings')
    unmount()
  })

  it('shows Settings when user has admin:settings', () => {
    const { container, unmount } = mount(
      <Sidebar
        permissions={['admin:settings'] satisfies Permission[]}
        user={TEST_USER}
      />,
    )
    expect(linkLabels(container)).toContain('Settings')
    unmount()
  })

  it('shows Admin only when user has admin:users', () => {
    const { container, rerender, unmount } = mount(
      <Sidebar
        permissions={['leads:read'] satisfies Permission[]}
        user={TEST_USER}
      />,
    )
    expect(linkLabels(container)).not.toContain('Admin')

    rerender(
      <Sidebar
        permissions={['admin:users'] satisfies Permission[]}
        user={TEST_USER}
      />,
    )
    expect(linkLabels(container)).toContain('Admin')
    unmount()
  })

  it('shows Cadences when user has either cadences:read or cadences:manage', () => {
    const { container, rerender, unmount } = mount(
      <Sidebar
        permissions={['cadences:read'] satisfies Permission[]}
        user={TEST_USER}
      />,
    )
    expect(linkLabels(container)).toContain('Cadences')

    rerender(
      <Sidebar
        permissions={['cadences:manage'] satisfies Permission[]}
        user={TEST_USER}
      />,
    )
    expect(linkLabels(container)).toContain('Cadences')

    rerender(<Sidebar permissions={[]} user={TEST_USER} />)
    expect(linkLabels(container)).not.toContain('Cadences')
    unmount()
  })

  it('shows all gated nav items when the user has every permission', () => {
    const allPerms: Permission[] = [
      'leads:read',
      'leads:write',
      'contacts:read',
      'cadences:manage',
      'cadences:read',
      'admin:users',
      'admin:settings',
      'forecast:read',
    ]
    const { container, unmount } = mount(
      <Sidebar permissions={allPerms} user={TEST_USER} />,
    )
    const labels = linkLabels(container)

    for (const label of [
      'Dashboard',
      'Pipeline',
      'Leads',
      'Contacts',
      'Companies',
      'Tasks',
      'Rhythm',
      'Cadences',
      'Forecast',
      'Import / Export',
      'Admin',
      'Settings',
    ]) {
      expect(labels).toContain(label)
    }
    unmount()
  })

  it('renders the organization name in the brand area when provided', () => {
    const { container, unmount } = mount(
      <Sidebar permissions={[]} organizationName="Acme Inc" user={TEST_USER} />,
    )
    expect(container.textContent).toContain('Acme Inc')
    unmount()
  })

  it('renders the pinned user card with name and role', () => {
    const { container, unmount } = mount(
      <Sidebar permissions={[]} user={TEST_USER} />,
    )
    expect(container.textContent).toContain('Maya Kessler')
    expect(container.textContent).toContain('RevOps Lead')
    const signOut = container.querySelector('button[aria-label="Sign out"]')
    expect(signOut).not.toBeNull()
    unmount()
  })
})
