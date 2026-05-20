'use client'

import { useState } from 'react'
import { Users, ScrollText, Layers, Trash2, Shield } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AuditLog } from '@/components/admin/audit-log'
import { UserManagement } from '@/components/admin/user-management'
import { TeamManagement } from '@/components/admin/team-management'
import { DeletionRequests } from '@/components/admin/deletion-requests'
import { RoleEditor } from '@/components/admin/role-editor'

/**
 * Admin page — user management, team hierarchy, audit log, and deletion requests.
 *
 * Accessible to users with `users:manage` or `audit:read` permissions
 * (OWNER, ADMIN roles). The sidebar already gates visibility of this route
 * based on effective permissions.
 *
 * Validates: Requirements 2.11, 3.7, 20.3, 33.6
 */

type AdminTab = 'users' | 'roles' | 'teams' | 'audit' | 'deletions'

const TABS: Array<{ id: AdminTab; label: string; icon: typeof Users }> = [
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'roles', label: 'Roles & Permissions', icon: Shield },
  { id: 'teams', label: 'Teams', icon: Layers },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'deletions', label: 'Deletion Requests', icon: Trash2 },
]

export default function AdminPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AdminTab>('users')

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Manage users, teams, review audit logs, and handle deletion requests.
        </p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        {/* Tab navigation */}
        <nav
          aria-label="Admin sections"
          className="flex flex-row gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-x-visible"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start gap-2"
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </Button>
            )
          })}
        </nav>

        {/* Tab content */}
        <section className="min-w-0 flex-1" aria-label={`${activeTab} admin panel`}>
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
