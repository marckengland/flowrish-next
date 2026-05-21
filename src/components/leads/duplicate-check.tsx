'use client'

import { useState } from 'react'
import { Search, Merge } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface DuplicateMatch {
  leadId: string
  leadName: string
  matchType: string
  matchValue: string
}

interface DuplicateCheckProps {
  leadId: string
  leadEmail: string | null
  companyName: string | null
}

/**
 * Duplicate detection UI for the lead detail sidebar.
 *
 * Calls POST /api/duplicates/check with the lead's email and company name,
 * then displays any matches found. Each match has a "Merge into this lead"
 * button that calls POST /api/leads/[id]/merge.
 *
 * Validates: Requirement 27.1, 27.3
 */
export function DuplicateCheck({ leadId, leadEmail, companyName }: DuplicateCheckProps): React.JSX.Element {
  const [matches, setMatches] = useState<DuplicateMatch[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [isMerging, setIsMerging] = useState<string | null>(null)
  const [hasChecked, setHasChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mergeSuccess, setMergeSuccess] = useState<string | null>(null)

  const handleCheck = async () => {
    setIsChecking(true)
    setError(null)
    setMergeSuccess(null)

    try {
      const body: Record<string, string> = {}
      if (leadEmail) body.contactEmail = leadEmail
      if (companyName) body.companyName = companyName

      const res = await fetch('/api/duplicates/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to check duplicates')
      }

      const { data } = await res.json()
      // Filter out the current lead from results
      const filtered = (data as DuplicateMatch[]).filter((m) => m.leadId !== leadId)
      setMatches(filtered)
      setHasChecked(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsChecking(false)
    }
  }

  const handleMerge = async (secondaryLeadId: string) => {
    setIsMerging(secondaryLeadId)
    setError(null)
    setMergeSuccess(null)

    try {
      const res = await fetch(`/api/leads/${leadId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secondaryLeadId }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message ?? 'Failed to merge leads')
      }

      setMergeSuccess(`Lead merged successfully.`)
      // Remove the merged lead from the list
      setMatches((prev) => prev.filter((m) => m.leadId !== secondaryLeadId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setIsMerging(null)
    }
  }

  const canCheck = Boolean(leadEmail || companyName)

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCheck}
        disabled={isChecking || !canCheck}
        className="w-full"
      >
        <Search className="size-4" aria-hidden="true" />
        <span>{isChecking ? 'Checking...' : 'Check for Duplicates'}</span>
      </Button>

      {!canCheck && (
        <p className="text-xs text-muted-foreground">
          No email or company name available to check.
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {mergeSuccess && (
        <p className="text-xs text-green-600" role="status">
          {mergeSuccess}
        </p>
      )}

      {hasChecked && matches.length === 0 && (
        <p className="text-xs text-muted-foreground">No duplicates found.</p>
      )}

      {matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {matches.length} potential {matches.length === 1 ? 'duplicate' : 'duplicates'} found
          </p>
          {matches.map((match) => (
            <div
              key={match.leadId}
              className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{match.leadName}</span>
                <span className="text-xs text-muted-foreground">
                  {match.matchType}: {match.matchValue}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleMerge(match.leadId)}
                disabled={isMerging === match.leadId}
                className="w-full"
              >
                <Merge className="size-3.5" aria-hidden="true" />
                <span>{isMerging === match.leadId ? 'Merging...' : 'Merge into this lead'}</span>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
