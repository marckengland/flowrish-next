import type { ReactNode } from 'react'
import { WorkspaceBoundary } from './workspace-boundary'

import { ChatbotSidebar } from '@/components/ai/chatbot-sidebar'
import { ChatbotToggle } from '@/components/ai/chatbot-toggle'
import { Header, type HeaderUser } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import type { Permission } from '@/types/permissions'

export interface ShellProps {
  /** Current authenticated user summary shown in the header. */
  user: HeaderUser
  /** Effective permissions used to filter sidebar items. */
  permissions: readonly Permission[]
  /** Organization display name shown in the sidebar brand area and header. */
  organizationName?: string
  workspaceId?: string
  notificationScope?: string
  children: ReactNode
}

/**
 * Main dashboard shell: sidebar (primary navigation) on the left, header
 * (user menu + chat toggle) on the top, and a scrollable content region
 * for page children.
 *
 * The shell composes the Zustand-driven interactive pieces (`Sidebar`,
 * `Header`) around server-rendered page content. It is itself a Server
 * Component — no `'use client'` directive — because it only forwards
 * already-resolved props and never reaches into browser APIs.
 *
 * Validates: Requirements 3.7, 26.4, 26.5
 */
export function Shell({
  user,
  permissions,
  organizationName,
  workspaceId,
  notificationScope,
  children,
}: ShellProps): React.JSX.Element {
  return (
    <WorkspaceBoundary organizationId={workspaceId}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar
          workspaceId={workspaceId}
          permissions={permissions}
          organizationName={organizationName}
          user={user}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header
            user={user}
            organizationName={organizationName}
            notificationScope={notificationScope}
          />
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-7 lg:px-8">
            {children}
          </main>
        </div>
        <ChatbotSidebar />
        <ChatbotToggle />
      </div>
    </WorkspaceBoundary>
  )
}
