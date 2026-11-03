'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  LayoutDashboard,
  GitBranchPlus,
  Users,
  Building2,
  CheckSquare,
  Zap,
  Activity,
  Settings,
  Target,
  FileSpreadsheet,
  ShieldCheck,
  TrendingUp,
  ChevronDown,
  LogOut,
  Radar,
  Inbox,
  BookOpen,
  Headset,
  X,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { useFocusTrap } from '@/hooks/use-focus-trap'
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
  /** Any group may grant access; every permission within that group is required. */
  permissionGroups?: readonly (readonly Permission[])[]
}

interface NavGroup {
  /** Optional mono uppercase group label rendered above the items. */
  label?: string
  items: readonly NavItem[]
}

/**
 * Grouped navigation for the dashboard shell, matching the design handoff:
 * a primary group, then AUTOMATION and WORKSPACE groups. Item visibility is
 * filtered at render time against the effective permission set.
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      {
        href: '/pipeline',
        label: 'Pipeline',
        icon: GitBranchPlus,
        permissions: ['leads:read'],
      },
      {
        href: '/leads',
        label: 'Leads',
        icon: Target,
        permissions: ['leads:read'],
      },
      {
        href: '/leads/discover',
        label: 'Find Leads',
        icon: Radar,
        permissions: ['leads:write'],
      },
      {
        href: '/contacts',
        label: 'Contacts',
        icon: Users,
        permissions: ['contacts:read'],
      },
      {
        href: '/companies',
        label: 'Companies',
        icon: Building2,
        permissions: ['contacts:read'],
      },
      { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    ],
  },
  {
    label: 'Automation',
    items: [
      { href: '/receptionist', label: 'Receptionist', icon: Headset, permissionGroups: [['admin:settings'], ['leads:read', 'leads:write']] },
      { href: '/rhythm', label: 'Rhythm', icon: Activity },
      { href: '/follow-ups', label: 'Follow-up inbox', icon: Inbox, permissions: ['leads:read'] },
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
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/knowledge', label: 'Knowledge library', icon: BookOpen, permissions: ['admin:settings'] },
      {
        href: '/csv',
        label: 'Import / Export',
        icon: FileSpreadsheet,
        permissions: ['leads:read'],
      },
      {
        href: '/admin',
        label: 'Admin',
        icon: ShieldCheck,
        permissions: ['admin:users'],
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: Settings,
        permissions: ['admin:settings'],
      },
    ],
  },
] as const

export interface SidebarUser {
  name: string
  email: string
  avatarUrl?: string | null
  /** Short role/title displayed under the name (e.g. "RevOps Lead"). */
  roleLabel?: string
}

export interface SidebarProps {
  /**
   * The effective permissions held by the current user. Items gated by
   * `permissions` are shown only when this set intersects the gate.
   */
  permissions: readonly Permission[]
  /** Optional organization display name shown in the brand area. */
  organizationName?: string
  /** Current user, shown in the pinned card at the bottom of the sidebar. */
  user: SidebarUser
}

/**
 * Primary navigation sidebar for the authenticated dashboard shell.
 *
 * Design: 238px dark surface, emerald lily logo + wordmark, grouped nav
 * (with mono uppercase group labels), emerald active state, and a pinned
 * user card with a sign-out control at the bottom.
 *
 * Validates: Requirements 3.7, 26.4, 26.5
 */
export function Sidebar({
  permissions,
  organizationName,
  user,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const mobileNavOpen = useLayoutStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useLayoutStore((s) => s.setMobileNavOpen)
  const asideRef = useRef<HTMLElement>(null)

  // Trap focus inside the drawer while it's open on mobile (parity with the
  // Dialog primitive): focus moves in, Tab loops, focus restores on close.
  useFocusTrap(mobileNavOpen, asideRef)

  // Close the mobile drawer on route change and on Escape.
  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname, setMobileNavOpen])
  useEffect(() => {
    if (!mobileNavOpen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileNavOpen, setMobileNavOpen])

  const permissionSet = new Set<Permission>(permissions)
  const isVisible = (item: NavItem): boolean => {
    if (item.permissionGroups) return item.permissionGroups.some(group => group.every(permission => permissionSet.has(permission)))
    if (!item.permissions || item.permissions.length === 0) return true
    return item.permissions.some((p) => permissionSet.has(p))
  }

  const isActive = (href: string): boolean => {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  async function handleSignOut(): Promise<void> {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut()
    } catch {
      // Ignore — we still redirect below.
    } finally {
      try {
        router.replace('/login')
        router.refresh()
      } finally {
        setSigningOut(false)
      }
    }
  }

  const initials = getInitials(user.name || user.email)
  const showAvatar = user.avatarUrl && !avatarFailed

  return (
    <>
      {/* Backdrop — mobile only, dismisses the drawer on tap. */}
      {mobileNavOpen ? (
        <div
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        ref={asideRef}
        tabIndex={-1}
        aria-label="Primary navigation"
        className={cn(
          // Off-canvas drawer on mobile; static rail from lg up.
          'fixed inset-y-0 left-0 z-50 flex h-full w-[264px] flex-col bg-sidebar px-3 py-3.5 text-sidebar-foreground outline-none transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[238px] lg:shrink-0 lg:translate-x-0 lg:shadow-none',
          mobileNavOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-2 pb-4 pt-1.5">
          <Image
            src="/flower-emerald.png"
            alt=""
            aria-hidden="true"
            width={20}
            height={20}
            className="size-5 object-contain"
          />
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">
            {organizationName ?? 'Flowrish'}
          </span>
          <ChevronDown
            className="hidden size-[15px] text-sidebar-foreground/45 lg:block"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
            className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

      {/* Nav */}
      <nav
        aria-label="Main"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {NAV_GROUPS.map((group, gi) => {
          const visible = group.items.filter(isVisible)
          if (visible.length === 0) return null
          return (
            <div key={group.label ?? `group-${gi}`} className="flex flex-col gap-0.5">
              {group.label && (
                <div className="eyebrow px-3 pb-1.5 pt-4 !text-[10px] !tracking-[0.09em] text-sidebar-foreground/40">
                  {group.label}
                </div>
              )}
              {visible.map(({ href, label, icon: Icon }) => {
                const active = isActive(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-[10px] px-3 py-[9px] text-[13.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                      href === '/receptionist' && 'min-h-11',
                      active
                        ? 'bg-brand/12 text-brand-emphasis'
                        : 'text-sidebar-foreground/65 hover:bg-white/[0.06] hover:text-sidebar-foreground',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-[17px] shrink-0',
                        active ? 'text-brand' : '',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{label}</span>
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Pinned user card */}
      <div className="mt-auto flex items-center gap-2.5 rounded-[10px] bg-white/[0.04] p-2.5">
        {showAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl!}
            alt=""
            aria-hidden="true"
            onError={() => setAvatarFailed(true)}
            referrerPolicy="no-referrer"
            className="size-[30px] shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-sidebar-primary-foreground"
          >
            {initials}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">
            {user.name}
          </div>
          <div className="truncate text-[11px] leading-tight text-sidebar-foreground/55">
            {user.roleLabel ?? user.email}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          title="Sign out"
          aria-label="Sign out"
          className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-sidebar-foreground/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-50"
        >
          <LogOut className="size-[15px]" aria-hidden="true" />
        </button>
      </div>
      </aside>
    </>
  )
}

function getInitials(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
