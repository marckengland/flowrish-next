'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  GitBranchPlus,
  Users,
  CheckSquare,
  Zap,
  Settings,
  Search,
  Target,
  FileSpreadsheet,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout'
import type { Permission } from '@/types/permissions'

/**
 * Navigation item definition. `permissions` is optional — when provided,
 * the user must hold at least one of the listed permissions for the item
 * to appear in the sidebar. Items without `permissions` are visible to all
 * authenticated users within the tenant.
 */
interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** User needs at least one of these permissions to see the item. */
  permissions?: readonly Permission[]
}

/**
 * Full navigation set for the dashboard shell. The visibility of each entry
 * is filtered at render time against the effective permissions of the current
 * user (union of all team role permissions — see `getEffectivePermissions`).
 */
const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: GitBranchPlus,
    permissions: ['leads:read'],
  },
  { href: '/leads', label: 'Leads', icon: Target, permissions: ['leads:read'] },
  {
    href: '/contacts',
    label: 'Contacts',
    icon: Users,
    permissions: ['contacts:read'],
  },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  {
    href: '/cadences',
    label: 'Cadences',
    icon: Zap,
    permissions: ['cadences:read', 'cadences:manage'],
  },
  {
    href: '/forecast',
    label: 'Forecast',
    icon: TrendingUp,
    permissions: ['forecast:read'],
  },
  {
    href: '/csv',
    label: 'CSV Import/Export',
    icon: FileSpreadsheet,
    permissions: ['leads:read'],
  },
  { href: '/search', label: 'Search', icon: Search },
  {
    href: '/admin',
    label: 'Admin',
    icon: ShieldCheck,
    permissions: ['users:manage'],
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    permissions: ['settings:manage'],
  },
] as const

export interface SidebarProps {
  /**
   * The effective permissions held by the current user. Items gated by
   * `permissions` are shown only when this set intersects the gate.
   */
  permissions: readonly Permission[]
  /** Optional organization display name shown in the brand area. */
  organizationName?: string
}

/**
 * Primary navigation sidebar for the authenticated dashboard shell.
 *
 * Features:
 * - Permission-based item filtering (Requirement 3.7)
 * - Collapsible narrow/wide modes driven by `useLayoutStore` (Requirement 26.4)
 * - Active route highlighting via `usePathname`
 * - Keyboard accessible with descriptive titles when collapsed
 *
 * Validates: Requirements 3.7, 26.4, 26.5
 */
export function Sidebar({
  permissions,
  organizationName,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname()
  const collapsed = useLayoutStore((s) => s.sidebarCollapsed)
  const toggle = useLayoutStore((s) => s.toggleSidebar)

  const permissionSet = new Set<Permission>(permissions)
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.permissions || item.permissions.length === 0) return true
    return item.permissions.some((p) => permissionSet.has(p))
  })

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <aside
      aria-label="Primary navigation"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
        {!collapsed ? (
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
            >
              F
            </span>
            <span className="truncate">
              {organizationName ?? 'Flowrish'}
            </span>
          </div>
        ) : (
          <span
            aria-hidden="true"
            className="mx-auto flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-sm font-semibold"
          >
            F
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          aria-controls="primary-navigation"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-1.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      <nav
        id="primary-navigation"
        aria-label="Main"
        className="flex-1 space-y-1 overflow-y-auto p-2"
      >
        {visibleItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                collapsed && 'justify-center px-2',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{label}</span>}
              {collapsed && <span className="sr-only">{label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
