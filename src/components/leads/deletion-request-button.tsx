'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface DeletionRequestButtonProps {
  leadId: string
  leadName: string
}

/**
 * "Request Deletion" button for non-admin users (those with leads:write but not leads:delete).
 *
 * Shows a form with a reason textarea, then calls POST /api/deletion-requests
 * to create a pending deletion request for review by an admin.
 *
 * Validates: Requirements 33.1, 33.2
 */
export function DeletionRequestButton({ leadId, leadName }: DeletionRequestButtonProps): React.JSX.Element {
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/deletion-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'Lead',
          entityId: leadId,
          entityName: leadName,
          reason: reason.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to submit deletion request')
      }

      setSuccess(true)
      setShowForm(false)
      setReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        Deletion request submitted. An admin will review it.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {!showForm ? (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setShowForm(true)}
          className="w-full"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          <span>Request Deletion</span>
        </Button>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label htmlFor="deletion-reason" className="text-xs font-medium text-muted-foreground">
            Reason for deletion (optional)
          </label>
          <textarea
            id="deletion-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why should this lead be deleted?"
            rows={3}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Request'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false)
                setReason('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
