'use client'

import { useState } from 'react'
import { Users, ScrollText, Layers, Trash2, Shield } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'
import { AuditLog } from '@/components/admin/audit-log'
import { UserManagement } from '@/components/admin/user-management'
import { TeamManagement } from '@/components/admin/team-management'
import { DeletionRequests } from '@/components/admin/deletion-requests'
import { RoleEditor } from '@/components/admin/role-editor'

/**
 * Admin page — user management, team hierarchy, audit log, and deletion requests.
 *
 * Accessible to users with `admin:users` or `audit:read` permissions
 * (OWNER, ADMIN roles). The sidebar already gates visibility of this route
 * based on effective permissions.
 *
 * Validates: Requirements 2.11, 3.7, 20.3, 33.6
 */

type AdminTab = 'users' | 'roles' | 'teams' | 'audit' | 'deletions'

const TABS: Array<{ id: AdminTab; label: string; icon: typeof Users }> = [
  { id: 'users', label: 'User management', icon: Users },
  { id: 'roles', label: 'Roles & permissions', icon: Shield },
  { id: 'teams', label: 'Teams', icon: Layers },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'deletions', label: 'Deletion requests', icon: Trash2 },
]

export default function AdminPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AdminTab>('users')

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5">
      <PageHeader
        title="Admin"
        description="User management, roles, teams & audit trail"
      />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[212px_1fr] lg:items-start lg:gap-6">
        {/* Left rail navigation */}
        <nav
          aria-label="Admin sections"
          className="flex flex-row gap-1 overflow-x-auto lg:flex-col lg:gap-[3px] lg:overflow-x-visible"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-brand-subtle text-brand-emphasis'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="size-[15px] shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Content panel */}
        <section className="min-w-0" aria-label={`${activeTab} admin panel`}>
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'roles' && <RoleEditor />}
          {activeTab === 'teams' && <TeamManagement />}
          {activeTab === 'audit' && <AuditLog />}
          {activeTab === 'deletions' && <DeletionRequests />}
        </section>
      </div>
    </div>
  )
}
