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
      return (await res.json()).data
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
        <h2 className="text-sm font-semibold text-foreground">
          Deletion requests
        </h2>
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
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-12">
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
        <div className="flex flex-col gap-2.5">
          {requests.map((request) => {
            const isPending = request.status === 'pending'
            return (
              <div
                key={request.id}
                className={`flex items-center gap-3.5 rounded-[11px] border p-4 ${
                  isPending
                    ? 'border-warning/50 bg-warning-subtle'
                    : 'border-border bg-card'
                }`}
              >
                <Trash2
                  className={`size-[17px] shrink-0 ${
                    isPending ? 'text-warning-foreground' : 'text-muted-foreground'
                  }`}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-foreground">
                      {request.entityName}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {request.entityType}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Requested by {request.requestedBy.name}
                    {' · '}
                    {new Date(request.createdAt).toLocaleString()}
                    {request.status !== 'pending' && (
                      <>
                        {' · '}
                        <span
                          className={
                            request.status === 'approved'
                              ? 'text-brand-emphasis'
                              : 'text-danger-foreground'
                          }
                        >
                          {request.status.charAt(0).toUpperCase() +
                            request.status.slice(1)}
                        </span>
                      </>
                    )}
                  </p>
                  {request.reason && (
                    <p className="text-xs text-muted-foreground">
                      Reason: {request.reason}
                    </p>
                  )}
                </div>

                {isPending && (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => approveMutation.mutate(request.id)}
                      disabled={approveMutation.isPending}
                      aria-label={`Approve deletion of ${request.entityName}`}
                    >
                      <Check className="size-3.5" aria-hidden="true" />
                      <span>Approve</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rejectMutation.mutate(request.id)}
                      disabled={rejectMutation.isPending}
                      aria-label={`Deny deletion of ${request.entityName}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                      <span>Deny</span>
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
