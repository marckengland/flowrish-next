'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

interface OrgUser {
  id: string
  name: string
  email: string | null
}

export interface TaskReassignProps {
  open: boolean
  onClose: () => void
  taskId: string
  taskTitle: string
  currentAssigneeId: string
  /** Optional callback fired after a successful reassignment. */
  onReassigned?: (newAssigneeId: string) => void
}

/**
 * Reassign-task dialog.
 *
 * Loads the org's user roster on demand (only fetches when the dialog
 * opens) and PATCHes the task with the chosen assignee. The route
 * (`PATCH /api/tasks/[id]`) reuses the same shape as task completion —
 * sending `assigneeId` triggers reassignment server-side.
 *
 * The picker filters out the current assignee so the user can't
 * "reassign" to the same person, which would just be a no-op.
 */
export function TaskReassign({
  open,
  onClose,
  taskId,
  taskTitle,
  currentAssigneeId,
  onReassigned,
}: TaskReassignProps): React.JSX.Element {
  const router = useRouter()
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const { data: users = [], isLoading } = useQuery<OrgUser[]>({
    queryKey: ['org-users', 'min'],
    enabled: open,
    queryFn: async () => {
      const res = await fetch('/api/admin/members', {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        // The members route requires admin permissions. If the user
        // can't load it, fall back to an empty list — the picker will
        // simply not show extra options. The reassign API still
        // enforces auth on its own.
        return []
      }
      const body = (await res.json()) as {
        data: Array<{ id: string; user: OrgUser }>
      }
      return body.data
        .map((m) => m.user)
        .filter((u) => u.id !== currentAssigneeId)
    },
  })

  function reassign(): void {
    if (!target) {
      setError('Select an assignee.')
      return
    }
    if (target === currentAssigneeId) {
      setError('Pick a different person — that user is already assigned.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ assigneeId: target }),
        })
        if (!res.ok) {
          let message = `Reassign failed (${res.status})`
          try {
            const body = (await res.json()) as { error?: { message?: string } }
            if (body.error?.message) message = body.error.message
          } catch {
            // ignore
          }
          setError(message)
          return
        }
        onReassigned?.(target)
        onClose()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reassign failed.')
      }
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Reassign task"
      description={taskTitle}
      size="sm"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={reassign}
            disabled={pending || !target}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Reassigning…</span>
              </>
            ) : (
              <span>Reassign</span>
            )}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label
          htmlFor="task-reassign-select"
          className="text-xs font-medium"
        >
          New assignee
        </label>
        <select
          id="task-reassign-select"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value)
            setError(null)
          }}
          disabled={isLoading || pending}
          className="h-9 w-full rounded-lg border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">
            {isLoading ? 'Loading users…' : 'Select assignee…'}
          </option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.email ? ` (${u.email})` : ''}
            </option>
          ))}
        </select>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
