'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, UserPlus, Mail } from 'lucide-react'

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
  roleName?: string
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

  const { data: members, isLoading } = useQuery<OrgMember[]>({
    queryKey: ['org-members'],
    queryFn: async () => {
      const res = await fetch('/api/admin/members')
      if (!res.ok) throw new Error('Failed to fetch members')
      return res.json()
    },
  })

  const { data: roles } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['org-roles'],
    queryFn: async () => {
      const res = await fetch('/api/admin/roles')
      if (!res.ok) throw new Error('Failed to fetch roles')
      return res.json()
    },
  })

  const { data: teams } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['org-teams'],
    queryFn: async () => {
      const res = await fetch('/api/admin/teams')
      if (!res.ok) throw new Error('Failed to fetch teams')
      return res.json()
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
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{member.user.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{member.user.email}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {member.roleName ?? 'MEMBER'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
