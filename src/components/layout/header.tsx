'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, MessagesSquare, User as UserIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { useLayoutStore } from '@/stores/layout'

/**
 * Minimal display view of the authenticated user shown in the header.
 * Accepts just the fields the header renders — decoupled from the full
 * `SessionUser` type so the component is easy to reuse and test.
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

/**
 * Top bar of the dashboard shell.
 *
 * Responsibilities:
 * - Surface the current user's identity and a sign-out action
 * - Provide a quick-toggle for the AI chatbot sidebar (Zustand layout store)
 * - Render the organization name as contextual breadcrumb when provided
 *
 * Sign-out is handled client-side via the browser Supabase client. On success
 * the user is redirected to `/login`; the middleware will also enforce that
 * redirect on any subsequent authenticated route request.
 *
 * Validates: Requirements 1.5, 26.4, 26.5
 */
export function Header({
  user,
  organizationName,
}: HeaderProps): React.JSX.Element {
  const router = useRouter()
  const chatOpen = useLayoutStore((s) => s.chatOpen)
  const toggleChat = useLayoutStore((s) => s.toggleChat)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut(): Promise<void> {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut()
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  const initials = getInitials(user.name || user.email)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 sm:px-6">
      <div className="min-w-0 flex-1">
        {organizationName && (
          <p className="truncate text-sm font-medium text-muted-foreground">
            {organizationName}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleChat}
          aria-pressed={chatOpen}
          aria-label={chatOpen ? 'Hide AI assistant' : 'Open AI assistant'}
          title={chatOpen ? 'Hide AI assistant' : 'Open AI assistant'}
        >
          <MessagesSquare className="size-4" aria-hidden="true" />
        </Button>

        <div className="flex items-center gap-2 rounded-md px-2 py-1">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt=""
              aria-hidden="true"
              className="size-7 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground',
              )}
            >
              {initials || <UserIcon className="size-4" aria-hidden="true" />}
            </span>
          )}
          <div className="hidden min-w-0 flex-col text-left sm:flex">
            <span className="truncate text-sm font-medium leading-tight text-foreground">
              {user.name}
            </span>
            <span className="truncate text-xs leading-tight text-muted-foreground">
              {user.email}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
        >
          <LogOut className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </span>
        </Button>
      </div>
    </header>
  )
}

function getInitials(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase()
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
