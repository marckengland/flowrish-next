'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Shield, ChevronDown, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Role editor component for creating and managing custom roles
 * with granular permission toggles.
 *
 * Features:
 * - View all roles with their permissions
 * - Create custom roles with selected permissions
 * - Edit permissions on any role (including system roles for OWNER)
 * - Delete custom roles (system roles are protected)
 * - Privilege escalation prevention (can't create higher-privilege roles)
 */

interface RolePermission {
  id: string
  key: string
}

interface Role {
  id: string
  name: string
  hierarchy: number
  isSystem: boolean
  permissions: RolePermission[]
}

interface RolesResponse {
  data: Role[]
  availablePermissions: readonly string[]
}

// Permission display labels grouped by category
const PERMISSION_GROUPS: Record<string, { label: string; permissions: string[] }> = {
  leads: {
    label: 'Leads',
    permissions: ['leads:read', 'leads:write', 'leads:delete'],
  },
  contacts: {
    label: 'Contacts',
    permissions: ['contacts:read', 'contacts:write'],
  },
  cadences: {
    label: 'Cadences',
    permissions: ['cadences:read', 'cadences:manage'],
  },
  forecast: {
    label: 'Forecast',
    permissions: ['forecast:read', 'forecast:submit'],
  },
  admin: {
    label: 'Admin',
    permissions: ['users:invite', 'admin:users', 'admin:settings', 'audit:read'],
  },
  system: {
    label: 'System',
    permissions: ['billing:manage'],
  },
}

function permissionLabel(key: string): string {
  const parts = key.split(':')
  return `${parts[1].charAt(0).toUpperCase()}${parts[1].slice(1)}`
}

export function RoleEditor(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [expandedRole, setExpandedRole] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const { data, isLoading } = useQuery<RolesResponse>({
    queryKey: ['admin-roles'],
    queryFn: async () => {
      const res = await fetch('/api/admin/roles')
      if (!res.ok) throw new Error('Failed to fetch roles')
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async (roleData: { name: string; hierarchy: number; permissions: string[] }) => {
      const res = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roleData),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to create role')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
      setShowCreateForm(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ roleId, permissions }: { roleId: string; permissions: string[] }) => {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to update role')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const res = await fetch(`/api/admin/roles/${roleId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to delete role')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-roles'] })
    },
  })

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading roles...</p>
  }

  const roles = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Roles &amp; permissions
        </h3>
        <Button
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
          variant={showCreateForm ? 'secondary' : 'default'}
        >
          <Plus className="size-4" />
          {showCreateForm ? 'Cancel' : 'New role'}
        </Button>
      </div>

      {showCreateForm && (
        <CreateRoleForm
          onSubmit={(roleData) => createMutation.mutate(roleData)}
          isPending={createMutation.isPending}
          error={createMutation.error?.message ?? null}
        />
      )}

      <div className="space-y-2">
        {roles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            isExpanded={expandedRole === role.id}
            onToggle={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
            onUpdatePermissions={(permissions) =>
              updateMutation.mutate({ roleId: role.id, permissions })
            }
            onDelete={() => deleteMutation.mutate(role.id)}
            isUpdating={updateMutation.isPending}
            deleteError={deleteMutation.error?.message ?? null}
          />
        ))}
      </div>
    </div>
  )
}

function RoleCard({
  role,
  isExpanded,
  onToggle,
  onUpdatePermissions,
  onDelete,
  isUpdating,
  deleteError,
}: {
  role: Role
  isExpanded: boolean
  onToggle: () => void
  onUpdatePermissions: (permissions: string[]) => void
  onDelete: () => void
  isUpdating: boolean
  deleteError: string | null
}) {
  const [editedPermissions, setEditedPermissions] = useState<Set<string>>(
    new Set(role.permissions.map((p) => p.key)),
  )
  const [hasChanges, setHasChanges] = useState(false)

  function togglePermission(key: string) {
    const next = new Set(editedPermissions)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setEditedPermissions(next)
    // Check if different from original
    const original = new Set(role.permissions.map((p) => p.key))
    const changed = next.size !== original.size || [...next].some((k) => !original.has(k))
    setHasChanges(changed)
  }

  function savePermissions() {
    onUpdatePermissions(Array.from(editedPermissions))
    setHasChanges(false)
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
          isExpanded
            ? 'bg-brand-subtle text-brand-emphasis'
            : 'hover:bg-muted/50',
        )}
      >
        <div className="flex items-center gap-3">
          <Shield
            className={cn(
              'size-4',
              isExpanded ? 'text-brand-emphasis' : 'text-muted-foreground',
            )}
          />
          <div>
            <span className="text-sm font-semibold">{role.name}</span>
            {role.isSystem && (
              <span className="ml-2 text-xs text-muted-foreground">(system)</span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            Hierarchy: {role.hierarchy} · {role.permissions.length} permissions
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t px-4 py-3 space-y-4">
          {/* Permission toggles grouped by category */}
          {Object.entries(PERMISSION_GROUPS).map(([groupKey, group]) => (
            <div key={groupKey}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {group.label}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.permissions.map((perm) => (
                  <label
                    key={perm}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={editedPermissions.has(perm)}
                      onChange={() => togglePermission(perm)}
                      className="size-4 rounded border-input accent-brand"
                    />
                    <span>{permissionLabel(perm)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t">
            {hasChanges && (
              <Button size="sm" onClick={savePermissions} disabled={isUpdating}>
                {isUpdating ? 'Saving...' : 'Save Permissions'}
              </Button>
            )}
            {!role.isSystem && (
              <Button
                size="sm"
                variant="destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-3" />
                Delete Role
              </Button>
            )}
            {deleteError && (
              <p className="text-xs text-danger-foreground">{deleteError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateRoleForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (data: { name: string; hierarchy: number; permissions: string[] }) => void
  isPending: boolean
  error: string | null
}) {
  const [name, setName] = useState('')
  const [hierarchy, setHierarchy] = useState(3)
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set())

  function togglePermission(key: string) {
    const next = new Set(selectedPermissions)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setSelectedPermissions(next)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      name,
      hierarchy,
      permissions: Array.from(selectedPermissions),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-4 bg-muted/30">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Role Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales Rep"
            required
            className="flex h-9 w-full rounded-[10px] border border-input bg-background px-3 py-1 text-sm shadow-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Hierarchy Level
            <span className="text-xs text-muted-foreground ml-1">(lower = more powerful)</span>
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={hierarchy}
            onChange={(e) => setHierarchy(parseInt(e.target.value, 10))}
            className="flex h-9 w-full rounded-[10px] border border-input bg-background px-3 py-1 text-sm shadow-sm"
          />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Permissions</p>
        {Object.entries(PERMISSION_GROUPS).map(([groupKey, group]) => (
          <div key={groupKey} className="mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {group.label}
            </p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {group.permissions.map((perm) => (
                <label key={perm} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedPermissions.has(perm)}
                    onChange={() => togglePermission(perm)}
                    className="size-4 rounded border-input accent-brand"
                  />
                  <span>{permissionLabel(perm)}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-danger-foreground">{error}</p>}

      <Button type="submit" disabled={isPending || !name.trim()}>
        {isPending ? 'Creating...' : 'Create Role'}
      </Button>
    </form>
  )
}
