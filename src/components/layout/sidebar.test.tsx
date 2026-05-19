import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from './sidebar'
import { useLayoutStore } from '@/stores/layout'
import type { Permission } from '@/types/permissions'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

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

  it('shows ungated items (Dashboard, Tasks, Search) to any user', () => {
    const { container, unmount } = mount(<Sidebar permissions={[]} />)
    const labels = linkLabels(container)

    expect(labels).toContain('Dashboard')
    expect(labels).toContain('Tasks')
    expect(labels).toContain('Search')
    unmount()
  })

  it('hides Settings when user lacks settings:manage', () => {
    const { container, unmount } = mount(
      <Sidebar permissions={['leads:read'] satisfies Permission[]} />,
    )
    expect(linkLabels(container)).not.toContain('Settings')
    unmount()
  })

  it('shows Settings when user has settings:manage', () => {
    const { container, unmount } = mount(
      <Sidebar permissions={['settings:manage'] satisfies Permission[]} />,
    )
    expect(linkLabels(container)).toContain('Settings')
    unmount()
  })

  it('shows Admin only when user has users:manage', () => {
    const { container, rerender, unmount } = mount(
      <Sidebar permissions={['leads:read'] satisfies Permission[]} />,
    )
    expect(linkLabels(container)).not.toContain('Admin')

    rerender(<Sidebar permissions={['users:manage'] satisfies Permission[]} />)
    expect(linkLabels(container)).toContain('Admin')
    unmount()
  })

  it('shows Cadences when user has either cadences:read or cadences:manage', () => {
    const { container, rerender, unmount } = mount(
      <Sidebar permissions={['cadences:read'] satisfies Permission[]} />,
    )
    expect(linkLabels(container)).toContain('Cadences')

    rerender(<Sidebar permissions={['cadences:manage'] satisfies Permission[]} />)
    expect(linkLabels(container)).toContain('Cadences')

    rerender(<Sidebar permissions={[]} />)
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
      'users:manage',
      'settings:manage',
    ]
    const { container, unmount } = mount(<Sidebar permissions={allPerms} />)
    const labels = linkLabels(container)

    for (const label of [
      'Dashboard',
      'Pipeline',
      'Leads',
      'Contacts',
      'Tasks',
      'Cadences',
      'CSV Import/Export',
      'Search',
      'Admin',
      'Settings',
    ]) {
      expect(labels).toContain(label)
    }
    unmount()
  })

  it('renders the organization name in the brand area when provided', () => {
    const { container, unmount } = mount(
      <Sidebar permissions={[]} organizationName="Acme Inc" />,
    )
    expect(container.textContent).toContain('Acme Inc')
    unmount()
  })

  it('reflects the collapsed state from the layout store via aria/data attributes', () => {
    useLayoutStore.setState({ sidebarCollapsed: true, chatOpen: false })
    const { container, unmount } = mount(
      <Sidebar permissions={['leads:read'] satisfies Permission[]} />,
    )

    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(aside?.getAttribute('data-collapsed')).toBe('true')

    const toggle = container.querySelector('button[aria-controls="primary-navigation"]')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(toggle?.getAttribute('aria-label')).toBe('Expand sidebar')
    unmount()
  })
})
