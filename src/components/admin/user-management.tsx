'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, UserPlus, Mail, Trash2, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * User management component — invite users and manage roles.
 *
 * Allows admins to:
 * - View current organization members with their roles
 * - Invite new users via email with a role assignment
 * - Update existing member roles
 *
 * Validates: Requirements 2.6, 2.7, 3.7
 */

interface OrgMember {
  id: string
  userId: string
  user: {
    id: string
    name: string
    email: string
    avatarUrl: string | null
  }
  joinedAt: string
  teamMemberships: Array<{
    role: { id: string; name: string; hierarchy: number }
    team: { id: string; name: string }
  }>
}

interface InviteFormData {
  email: string
  roleId: string
  teamId: string
}

const DEFAULT_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] as const

export function UserManagement(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteData, setInviteData] = useState<InviteFormData>({
    email: '',
    roleId: '',
    teamId: '',
  })
  const [confirmAction, setConfirmAction] = useState<{
    type: 'remove' | 'leave'
    member: OrgMember
  } | null>(null)

  const { data: members, isLoading } = useQuery<OrgMember[]>({
    queryKey: ['org-members'],
    queryFn: async () => {
      const res = await fetch('/api/admin/members')
      if (!res.ok) throw new Error('Failed to fetch members')
      return (await res.json()).data
    },
  })

  const { data: roles } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['org-roles'],
    queryFn: async () => {
      const res = await fetch('/api/admin/roles')
      if (!res.ok) throw new Error('Failed to fetch roles')
      return (await res.json()).data
    },
  })

  const { data: teams } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['org-teams'],
    queryFn: async () => {
      const res = await fetch('/api/admin/teams')
      if (!res.ok) throw new Error('Failed to fetch teams')
      return (await res.json()).data
    },
  })

  const inviteMutation = useMutation({
    mutationFn: async (data: InviteFormData) => {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to send invite')
      }
      return res.json()
    },
    onSuccess: () => {
      setShowInviteForm(false)
      setInviteData({ email: '', roleId: '', teamId: '' })
      queryClient.invalidateQueries({ queryKey: ['org-members'] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (membershipId: string) => {
      const res = await fetch(`/api/admin/members/${membershipId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to remove member')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-members'] })
    },
  })

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteData.email || !inviteData.roleId) return
    inviteMutation.mutate(inviteData)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">User Management</h2>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowInviteForm(!showInviteForm)}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          <span>Invite User</span>
        </Button>
      </div>

      {/* Invite form */}
      {showInviteForm && (
        <form
          onSubmit={handleInviteSubmit}
          className="flex flex-col gap-3 rounded-md border bg-card p-4"
        >
          <h3 className="text-sm font-semibold">Invite a new member</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-email" className="text-xs font-medium text-muted-foreground">
                Email address
              </label>
              <input
                id="invite-email"
                type="email"
                required
                placeholder="user@example.com"
                value={inviteData.email}
                onChange={(e) => setInviteData((prev) => ({ ...prev, email: e.target.value }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="invite-role" className="text-xs font-medium text-muted-foreground">
                Role
              </label>
              <select
                id="invite-role"
                required
                value={inviteData.roleId}
                onChange={(e) => setInviteData((prev) => ({ ...prev, roleId: e.target.value }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Select role...</option>
                {roles?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="invite-team" className="text-xs font-medium text-muted-foreground">
                Team (optional)
              </label>
              <select
                id="invite-team"
                value={inviteData.teamId}
                onChange={(e) => setInviteData((prev) => ({ ...prev, teamId: e.target.value }))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">No team</option>
                {teams?.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={inviteMutation.isPending}>
              <Mail className="size-4" aria-hidden="true" />
              <span>{inviteMutation.isPending ? 'Sending...' : 'Send Invite'}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowInviteForm(false)}
            >
              Cancel
            </Button>
          </div>

          {inviteMutation.isError && (
            <p className="text-xs text-destructive" role="alert">
              {inviteMutation.error.message}
            </p>
          )}
        </form>
      )}

      {/* Members list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading members...</p>
        </div>
      ) : !members || members.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border bg-card py-12">
          <Users className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No members found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Joined</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{member.user.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{member.user.email}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {(() => {
                        const tms = member.teamMemberships ?? []
                        if (tms.length === 0) return 'No role'
                        // Show the highest-privilege role (lowest hierarchy)
                        const best = tms.reduce((a: any, b: any) =>
                          (a.role?.hierarchy ?? 99) <= (b.role?.hierarchy ?? 99) ? a : b
                        )
                        return best.role?.name ?? 'No role'
                      })()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setConfirmAction({ type: 'remove', member })}
                      disabled={removeMutation.isPending}
                    >
                      <Trash2 className="size-3.5" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmAction(null)}>
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground">
              {confirmAction.type === 'remove' ? 'Remove Member' : 'Leave Organization'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmAction.type === 'remove' ? (
                <>
                  Are you sure you want to remove <strong>{confirmAction.member.user.name}</strong> from the organization?
                  They will lose access to all data and features. This action cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to leave this organization?
                  You will lose access to all data and features. You&apos;ll need a new invite to rejoin.
                </>
              )}
            </p>
            {removeMutation.error && (
              <p className="mt-2 text-sm text-destructive">{removeMutation.error.message}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={removeMutation.isPending}
                onClick={() => {
                  removeMutation.mutate(confirmAction.member.id, {
                    onSuccess: () => setConfirmAction(null),
                  })
                }}
              >
                {removeMutation.isPending
                  ? 'Processing...'
                  : confirmAction.type === 'remove'
                    ? 'Remove Member'
                    : 'Leave Organization'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
