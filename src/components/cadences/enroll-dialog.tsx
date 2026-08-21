'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { inputBaseClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  useBulkEnrollMutation,
  useEnrollLeadMutation,
} from '@/hooks/use-cadences'

/**
 * Lead option shape consumed by the enroll dialog. The parent page resolves
 * the leads available to the current user (via RBAC access filter) and
 * passes them in.
 */
export interface EnrollDialogLead {
  id: string
  firstName: string
  lastName: string
  email: string | null
  companyName: string | null
}

export interface EnrollDialogProps {
  cadenceId: string
  leads: readonly EnrollDialogLead[]
  /**
   * Whether the current cadence is ACTIVE. Enrollment is only allowed on
   * active cadences (Requirement 6.5) — when false the trigger is disabled.
   */
  canEnroll: boolean
  /** Optional extra class for the trigger button. */
  className?: string
}

/**
 * Enroll-lead dialog — supports both single enrollment and bulk enrollment.
 *
 * - Single mode: a search-and-select input (native datalist for a11y) that
 *   resolves to one lead ID and POSTs to `/api/cadences/[id]/enroll`.
 * - Bulk mode: a multi-select checkbox list that POSTs to
 *   `/api/cadences/[id]/bulk-enroll`, surfacing enrolled/skipped counts in
 *   the confirmation.
 *
 * Validates: Requirements 6.5, 6.6, 32.5
 */
export function EnrollDialog({
  cadenceId,
  leads,
  canEnroll,
  className,
}: EnrollDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'single' | 'bulk'>('single')

  return (
    <div className={cn('inline-flex', className)}>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!canEnroll}
        title={
          canEnroll
            ? undefined
            : 'Activate the cadence before enrolling leads.'
        }
      >
        <UserPlus className="size-4" aria-hidden="true" />
        <span>Enroll leads</span>
      </Button>

      {open && (
        <EnrollModal
          cadenceId={cadenceId}
          leads={leads}
          mode={mode}
          onModeChange={setMode}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

interface EnrollModalProps {
  cadenceId: string
  leads: readonly EnrollDialogLead[]
  mode: 'single' | 'bulk'
  onModeChange: (mode: 'single' | 'bulk') => void
  onClose: () => void
}

function EnrollModal({
  cadenceId,
  leads,
  mode,
  onModeChange,
  onClose,
}: EnrollModalProps): React.JSX.Element {
  const router = useRouter()
  const [selectedSingle, setSelectedSingle] = useState('')
  const [selectedBulk, setSelectedBulk] = useState<readonly string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [result, setResult] = useState<
    | { type: 'single'; leadId: string }
    | { type: 'bulk'; enrolledCount: number; skippedCount: number }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const enrollOne = useEnrollLeadMutation()
  const enrollMany = useBulkEnrollMutation()

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return leads
    return leads.filter((lead) => {
      const name = `${lead.firstName} ${lead.lastName}`.toLowerCase()
      const email = (lead.email ?? '').toLowerCase()
      const company = (lead.companyName ?? '').toLowerCase()
      return (
        name.includes(q)
        || email.includes(q)
        || company.includes(q)
      )
    })
  }, [leads, searchQuery])

  function toggleBulk(id: string): void {
    setSelectedBulk((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function handleSubmit(): void {
    setError(null)
    setResult(null)
    startTransition(async () => {
      try {
        if (mode === 'single') {
          if (!selectedSingle) {
            setError('Select a lead to enroll.')
            return
          }
          await enrollOne.mutateAsync({ cadenceId, leadId: selectedSingle })
          setResult({ type: 'single', leadId: selectedSingle })
          router.refresh()
        } else {
          if (selectedBulk.length === 0) {
            setError('Select at least one lead to enroll.')
            return
          }
          const data = await enrollMany.mutateAsync({
            cadenceId,
            leadIds: [...selectedBulk],
          })
          setResult({
            type: 'bulk',
            enrolledCount: data.enrolledCount,
            skippedCount: data.skippedCount,
          })
          router.refresh()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to enroll.')
      }
    })
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Enroll leads"
      description="Leads already actively enrolled in this cadence are skipped automatically."
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isPending}
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result ? (
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={
                isPending
                || leads.length === 0
                || (mode === 'single' && !selectedSingle)
                || (mode === 'bulk' && selectedBulk.length === 0)
              }
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Enrolling…</span>
                </>
              ) : (
                <span>
                  {mode === 'bulk' && selectedBulk.length > 0
                    ? `Enroll ${selectedBulk.length} lead${selectedBulk.length === 1 ? '' : 's'}`
                    : 'Enroll lead'}
                </span>
              )}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label="Enrollment mode"
          className="flex gap-1 self-start rounded-md border p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'single'}
            onClick={() => onModeChange('single')}
            className={cn(
              'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
              mode === 'single'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Single
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'bulk'}
            onClick={() => onModeChange('bulk')}
            className={cn(
              'rounded-sm px-2 py-1 text-xs font-medium transition-colors',
              mode === 'bulk'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Bulk
          </button>
        </div>

        {leads.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No leads are available for enrollment.
          </p>
        ) : mode === 'single' ? (
          <SingleSelect
            leads={leads}
            value={selectedSingle}
            onChange={setSelectedSingle}
          />
        ) : (
          <BulkSelect
            leads={filteredLeads}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selected={selectedBulk}
            onToggle={toggleBulk}
            totalCount={leads.length}
          />
        )}

        {error ? (
          <p role="alert" className="text-sm text-danger-foreground">
            {error}
          </p>
        ) : null}

        {result ? (
          <div
            role="status"
            className="rounded-[10px] border border-brand/30 bg-brand-subtle px-3 py-2 text-sm text-brand-emphasis"
          >
            {result.type === 'single'
              ? 'Lead enrolled.'
              : `Enrolled ${result.enrolledCount} lead${result.enrolledCount === 1 ? '' : 's'}${
                  result.skippedCount > 0
                    ? `, skipped ${result.skippedCount} already enrolled.`
                    : '.'
                }`}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function SingleSelect({
  leads,
  value,
  onChange,
}: {
  leads: readonly EnrollDialogLead[]
  value: string
  onChange: (id: string) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">Lead</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputBaseClass}
      >
        <option value="">Select a lead…</option>
        {leads.map((lead) => (
          <option key={lead.id} value={lead.id}>
            {leadDisplayName(lead)}
            {lead.companyName ? ` · ${lead.companyName}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function BulkSelect({
  leads,
  searchQuery,
  onSearchChange,
  selected,
  onToggle,
  totalCount,
}: {
  leads: readonly EnrollDialogLead[]
  searchQuery: string
  onSearchChange: (q: string) => void
  selected: readonly string[]
  onToggle: (id: string) => void
  totalCount: number
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-foreground">
          Filter leads
        </span>
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search name, email, or company…"
        />
      </label>
      <div className="text-xs text-muted-foreground">
        {selected.length} selected · showing {leads.length} of {totalCount}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        {leads.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No matches.</p>
        ) : (
          <ul className="divide-y">
            {leads.map((lead) => {
              const checked = selected.includes(lead.id)
              return (
                <li key={lead.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/40',
                      checked && 'bg-muted/40',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(lead.id)}
                      className="size-4 shrink-0"
                    />
                    <span className="flex-1 text-sm">
                      <span className="font-medium text-foreground">
                        {leadDisplayName(lead)}
                      </span>
                      {lead.companyName ? (
                        <span className="ml-1 text-muted-foreground">
                          · {lead.companyName}
                        </span>
                      ) : null}
                      {lead.email ? (
                        <div className="text-xs text-muted-foreground">
                          {lead.email}
                        </div>
                      ) : null}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function leadDisplayName(lead: EnrollDialogLead): string {
  const parts = [lead.firstName, lead.lastName].filter(Boolean)
  return parts.join(' ').trim() || lead.email || 'Unnamed lead'
}
