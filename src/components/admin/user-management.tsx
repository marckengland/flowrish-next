'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, UserPlus, Mail, Trash2, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/lib/toast'

/** Two-letter initials for an avatar chip, derived from a display name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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
  const [transferTargetId, setTransferTargetId] = useState('')
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)

  // Get current user's email to identify self in the list
  if (!currentUserEmail) {
    import('@/lib/supabase/client').then(({ createSupabaseBrowser }) => {
      const supabase = createSupabaseBrowser()
      supabase.auth.getUser().then(({ data }) => {
        if (data.user?.email) setCurrentUserEmail(data.user.email)
      })
    })
  }

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

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/members/leave', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to leave organization')
      }
      return res.json()
    },
    onSuccess: () => {
      window.location.href = '/onboarding'
    },
  })

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteData.email || !inviteData.roleId) return
    inviteMutation.mutate(inviteData)
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {members && members.length > 0
            ? `${members.length} member${members.length === 1 ? '' : 's'}`
            : 'Members'}
        </h2>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowInviteForm(!showInviteForm)}
        >
          <UserPlus className="size-4" aria-hidden="true" />
          <span>Invite member</span>
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
            <p className="text-xs text-danger-foreground" role="alert">
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
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12">
          <Users className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">No members found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="eyebrow px-4 py-3 text-left">Member</th>
                <th className="eyebrow px-4 py-3 text-left">Role</th>
                <th className="eyebrow px-4 py-3 text-left">Teams</th>
                <th className="eyebrow px-4 py-3 text-left">Status</th>
                <th className="eyebrow px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const tms = member.teamMemberships ?? []
                type TM = (typeof tms)[number]
                const roleName =
                  tms.length === 0
                    ? 'No role'
                    : (tms.reduce((a: TM, b: TM) =>
                        (a.role?.hierarchy ?? 99) <= (b.role?.hierarchy ?? 99)
                          ? a
                          : b,
                      ).role?.name ?? 'No role')
                const isOwnerRole = roleName.toUpperCase() === 'OWNER'
                const teamNames = tms.map((tm) => tm.team?.name).filter(Boolean)
                return (
                  <tr
                    key={member.id}
                    className="border-b border-row-divider last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-foreground">
                          {initials(member.user.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-semibold text-foreground">
                            {member.user.name}
                            {member.user.email === currentUserEmail && (
                              <Badge variant="brand" size="sm">
                                YOU
                              </Badge>
                            )}
                          </div>
                          <div className="truncate text-[11.5px] text-muted-foreground">
                            {member.user.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={isOwnerRole ? 'solid' : 'neutral'} size="md">
                        {roleName}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {teamNames.length > 0 ? teamNames.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-brand-emphasis">
                        <span className="size-1.5 rounded-full bg-brand" />
                        Active
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {member.user.email === currentUserEmail ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:bg-danger-subtle hover:text-danger-foreground"
                          onClick={() => setConfirmAction({ type: 'leave', member })}
                          disabled={leaveMutation.isPending}
                        >
                          <LogOut className="size-3.5" />
                          <span className="text-xs">Leave</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:bg-danger-subtle hover:text-danger-foreground"
                          onClick={() => setConfirmAction({ type: 'remove', member })}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only">Remove</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation Modal — routed through the shared Dialog primitive
          so it inherits Escape-to-close, focus trap, focus restore, and
          the reference-counted body scroll lock. */}
      <Dialog
        open={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={
          confirmAction?.type === 'remove'
            ? 'Remove Member'
            : 'Leave Organization'
        }
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={removeMutation.isPending || leaveMutation.isPending}
              onClick={() => {
                if (!confirmAction) return
                if (confirmAction.type === 'remove') {
                  removeMutation.mutate(confirmAction.member.id, {
                    onSuccess: () => setConfirmAction(null),
                  })
                } else {
                  leaveMutation.mutate()
                }
              }}
            >
              {(removeMutation.isPending || leaveMutation.isPending)
                ? 'Processing...'
                : confirmAction?.type === 'remove'
                  ? 'Remove Member'
                  : 'Leave Organization'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {confirmAction?.type === 'remove' ? (
            <>
              Are you sure you want to remove{' '}
              <strong>{confirmAction.member.user.name}</strong> from the
              organization? They will lose access to all data and features.
              This action cannot be undone.
            </>
          ) : (
            <>
              Are you sure you want to leave this organization? You will lose
              access to all data and features. You&apos;ll need a new invite
              to rejoin.
            </>
          )}
        </p>
        {confirmAction?.type === 'remove' && removeMutation.error && (
          <p role="alert" className="mt-2 text-sm text-danger-foreground">
            {removeMutation.error.message}
          </p>
        )}
        {confirmAction?.type === 'leave' && leaveMutation.error && (
          <p role="alert" className="mt-2 text-sm text-danger-foreground">
            {leaveMutation.error.message}
          </p>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmTransferOpen}
        onClose={() => setConfirmTransferOpen(false)}
        onConfirm={async () => {
          if (!transferTargetId) return
          const res = await fetch('/api/admin/members/transfer-ownership', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUserId: transferTargetId }),
          })
          if (res.ok) {
            queryClient.invalidateQueries({ queryKey: ['org-members'] })
            toast.success('Ownership transferred')
            setConfirmTransferOpen(false)
            setTransferTargetId('')
          } else {
            const err = await res.json().catch(() => ({}))
            toast.error(err?.error?.message ?? 'Transfer failed')
          }
        }}
        title="Transfer ownership"
        description={`Transfer ownership to ${
          members?.find((m) => m.user.id === transferTargetId)?.user.name ??
          'this member'
        }? You will be downgraded to Admin.`}
        confirmLabel="Transfer ownership"
      />

      {/* Leave Organization — shown at the bottom */}
      {members && members.length > 0 && (
        <div className="border-t pt-4 mt-4 space-y-4">
          {/* Transfer Ownership (only visible to current user if they're the OWNER) */}
          {(() => {
            // Find the signed-in user by email
            const currentUserMember = members.find((m) => m.user.email === currentUserEmail)
            // Check if they're an OWNER
            const isOwner = currentUserMember?.teamMemberships?.some(
              (tm) => tm.role?.name === 'OWNER',
            ) ?? false
            const otherMembers = members.filter((m) => m.id !== currentUserMember?.id)

            if (!isOwner || otherMembers.length === 0) return null

            return (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Transfer Ownership</p>
                  <p className="text-xs text-muted-foreground">
                    Make another member the owner. You&apos;ll be downgraded to Admin.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    id="transfer-target"
                    aria-label="Select member to transfer ownership to"
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={transferTargetId}
                    onChange={(e) => setTransferTargetId(e.target.value)}
                  >
                    <option value="" disabled>Select member...</option>
                    {otherMembers.map((m) => (
                      <option key={m.user.id} value={m.user.id}>
                        {m.user.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!transferTargetId}
                    onClick={() => setConfirmTransferOpen(true)}
                  >
                    Transfer
                  </Button>
                </div>
              </div>
            )
          })()}

          {/* Leave Organization */}
        </div>
      )}
    </div>
  )
}
