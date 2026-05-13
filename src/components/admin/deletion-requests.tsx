'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * Pending deletion request review component.
 *
 * Displays pending deletion requests and allows admins/managers to
 * approve or reject them. Shows an empty state when no pending requests exist.
 *
 * - Approve: executes the deletion (soft-delete for leads, hard-delete for contacts/tasks)
 * - Reject: marks the request as rejected without performing any deletion
 *
 * Validates: Requirements 33.3, 33.4, 33.6
 */

interface DeletionRequest {
  id: string
  entityType: string
  entityId: string
  entityName: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: {
    id: string
    name: string
    email: string
  }
  createdAt: string
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all'

export function DeletionRequests(): React.JSX.Element {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')

  const queryParams = new URLSearchParams()
  if (statusFilter !== 'all') queryParams.set('status', statusFilter)

  const { data: requests, isLoading } = useQuery<DeletionRequest[]>({
    queryKey: ['deletion-requests', statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/deletion-requests?${queryParams.toString()}`)
      if (!res.ok) throw new Error('Failed to fetch deletion requests')
      return res.json()
    },
  })

  const approveMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(`/api/deletion-requests/${requestId}/approve`, {
        method: 'PATCH',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to approve request')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deletion-requests'] })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await fetch(`/api/deletion-requests/${requestId}/reject`, {
        method: 'PATCH',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to reject request')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deletion-requests'] })
    },
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trash2 className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">Deletion Requests</h2>
        </div>
        <div className="flex gap-1">
          {(['pending', 'approved', 'rejected', 'all'] as const).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setStatusFilter(status)}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {/* Request list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Loading requests...</p>
        </div>
      ) : !requests || requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border bg-card py-12">
          <Trash2 className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            No {statusFilter === 'all' ? '' : statusFilter} deletion requests
          </p>
          <p className="text-xs text-muted-foreground">
            {statusFilter === 'pending'
              ? 'Pending requests will appear here when members request entity deletions.'
              : 'No requests match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((request) => (
            <div
              key={request.id}
              className="flex flex-col gap-2 rounded-md border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {request.entityType}
                    </span>
                    <span className="text-sm font-medium">{request.entityName}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Requested by {request.requestedBy.name} ({request.requestedBy.email})
                    {' · '}
                    {new Date(request.createdAt).toLocaleString()}
                  </p>
                  {request.reason && (
                    <p className="text-xs text-muted-foreground">
                      Reason: {request.reason}
                    </p>
                  )}
                </div>

                {request.status === 'pending' && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="default"
                      size="xs"
                      onClick={() => approveMutation.mutate(request.id)}
                      disabled={approveMutation.isPending}
                      aria-label={`Approve deletion of ${request.entityName}`}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      <span>Approve</span>
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => rejectMutation.mutate(request.id)}
                      disabled={rejectMutation.isPending}
                      aria-label={`Reject deletion of ${request.entityName}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      <span>Reject</span>
                    </Button>
                  </div>
                )}

                {request.status !== 'pending' && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      request.status === 'approved'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                  >
                    {request.status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
