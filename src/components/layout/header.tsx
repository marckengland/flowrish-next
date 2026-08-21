'use client'

import { useRouter, usePathname } from 'next/navigation'
import { Bell, Bot, Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout'
import { ThemeToggle } from '@/components/layout/theme-toggle'

/**
 * Minimal display view of the authenticated user. Kept for API
 * compatibility with the shell even though the header no longer renders
 * the user card (it now lives pinned in the sidebar).
 */
export interface HeaderUser {
  name: string
  email: string
  avatarUrl?: string | null
}

export interface HeaderProps {
  user: HeaderUser
  organizationName?: string
}

/** Maps a pathname to the breadcrumb page label shown in the topbar. */
const PAGE_TITLES: Array<{ prefix: string; label: string }> = [
  { prefix: '/dashboard', label: 'Dashboard' },
  { prefix: '/pipeline', label: 'Pipeline' },
  { prefix: '/leads', label: 'Leads' },
  { prefix: '/contacts', label: 'Contacts' },
  { prefix: '/companies', label: 'Companies' },
  { prefix: '/tasks', label: 'Tasks' },
  { prefix: '/rhythm', label: 'Rhythm' },
  { prefix: '/cadences', label: 'Cadences' },
  { prefix: '/forecast', label: 'Forecast' },
  { prefix: '/csv', label: 'Import / Export' },
  { prefix: '/search', label: 'Search' },
  { prefix: '/admin', label: 'Admin' },
  { prefix: '/settings', label: 'Settings' },
]

function pageTitle(pathname: string): string {
  const match = PAGE_TITLES.find((p) => pathname.startsWith(p.prefix))
  return match?.label ?? 'Dashboard'
}

/**
 * Top bar of the dashboard shell.
 *
 * Design: mono breadcrumb `Org / Page`, a search field that routes to the
 * search screen, a notification bell, an (optional) theme toggle, and a
 * dark "Airish" button that opens the AI assistant drawer.
 *
 * Validates: Requirements 1.5, 26.4, 26.5
 */
export function Header({
  organizationName,
}: HeaderProps): React.JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const chatOpen = useLayoutStore((s) => s.chatOpen)
  const toggleChat = useLayoutStore((s) => s.toggleChat)

  const title = pageTitle(pathname)

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 border-b bg-card px-6">
      <div className="font-mono text-[12px] text-muted-foreground">
        {organizationName ?? 'Flowrish'}{' '}
        <span className="text-foreground/25">/</span>{' '}
        <span className="text-foreground/70">{title}</span>
      </div>

      <button
        type="button"
        onClick={() => router.push('/search')}
        title="Search leads, contacts & companies"
        className="relative ml-auto hidden h-[38px] w-full max-w-[360px] items-center rounded-[10px] border bg-background pl-9 pr-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-card focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand/15 sm:flex"
      >
        <Search
          className="absolute left-3 size-[15px] text-muted-foreground"
          aria-hidden="true"
        />
        Search leads, contacts, deals…
      </button>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push('/search')}
          title="Search"
          aria-label="Search"
          className="flex size-[38px] items-center justify-center rounded-[10px] border bg-card text-foreground/60 transition-colors hover:bg-muted sm:hidden"
        >
          <Search className="size-[17px]" aria-hidden="true" />
        </button>

        <ThemeToggle />

        <button
          type="button"
          title="Notifications"
          aria-label="Notifications"
          className="flex size-[38px] items-center justify-center rounded-[10px] border bg-card text-foreground/60 transition-colors hover:bg-muted"
        >
          <Bell className="size-[17px]" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={toggleChat}
          aria-pressed={chatOpen}
          aria-label={chatOpen ? 'Hide Airish' : 'Open Airish'}
          title={chatOpen ? 'Hide Airish' : 'Ask Airish'}
          className={cn(
            'flex h-[38px] items-center gap-[7px] rounded-[10px] px-3.5 text-[13px] font-semibold text-white transition-colors',
            'bg-[oklch(0.16_0_0)] hover:bg-[oklch(0.24_0_0)] dark:bg-white/10 dark:hover:bg-white/15',
          )}
        >
          <Bot className="size-[15px]" aria-hidden="true" />
          <span className="hidden sm:inline">Airish</span>
        </button>
      </div>
    </header>
  )
}
