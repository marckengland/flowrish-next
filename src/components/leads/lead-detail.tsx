'use client'

import { useState } from 'react'
import { Pencil, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { LeadForm, type LeadFormStage, type LeadFormValues } from '@/components/leads/lead-form'

export interface LeadDetailProps {
  lead: LeadFormValues & {
    stage?: {
      id: string
      name: string
      isClosedWon?: boolean
      isClosedLost?: boolean
    }
    assignedUser?: {
      id: string
      name: string
      email: string
    } | null
    companyName?: string | null
    lastActivityAt?: string | null
  }
  stages: readonly LeadFormStage[]
  /**
   * Whether the current user can edit this lead. When false, the edit
   * toggle is hidden and only the read-only view is available.
   */
  canEdit: boolean
}

/**
 * Two-mode lead info panel: a read-only summary of the lead's key fields,
 * plus an edit mode that re-uses `LeadForm` for field-level editing.
 *
 * The read-only view is deliberately compact so the adjacent activity
 * timeline, conversation intelligence, and convert controls remain the
 * page's focus. `canEdit` is resolved server-side from the user's
 * `leads:write` permission and propagated in as a boolean.
 *
 * Validates: Requirements 4.1, 4.2, 5.1, 29.1
 */
export function LeadDetail({
  lead,
  stages,
  canEdit,
}: LeadDetailProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <section
        aria-label="Edit lead"
        className="flex flex-col gap-3 rounded-md border bg-card p-4"
      >
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Edit lead</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setEditing(false)}
            aria-label="Cancel edit"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>
        <LeadForm
          stages={stages}
          lead={lead}
          onSuccess={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </section>
    )
  }

  return (
    <section
      aria-label="Lead details"
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">
            {fullName(lead)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {lead.title ? `${lead.title} · ` : ''}
            {lead.companyName ?? 'No company'}
          </p>
        </div>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" aria-hidden="true" />
            <span>Edit</span>
          </Button>
        ) : null}
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label="Email" value={lead.email} />
        <Field label="Phone" value={lead.phone} />
        <Field label="Stage" value={lead.stage?.name} />
        <Field label="Status" value={prettyStatus(lead.leadStatus)} />
        <Field label="Tier" value={prettyTier(lead.tier)} />
        <Field
          label="Deal value"
          value={formatCurrency(lead.dealValue, lead.currency ?? 'USD')}
        />
        <Field label="Lead score" value={lead.score != null ? String(lead.score) : null} />
        <Field
          label="Last activity"
          value={formatRelative(lead.lastActivityAt ?? null)}
        />
        <Field
          label="Assignee"
          value={lead.assignedUser?.name ?? 'Unassigned'}
        />
        <Field label="Country" value={lead.country} />
        <Field label="State / Region" value={lead.state} />
        <Field
          label="LinkedIn"
          value={
            lead.linkedinUrl ? (
              <a
                href={lead.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {lead.linkedinUrl}
              </a>
            ) : null
          }
        />
      </dl>

      {lead.description ? (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {lead.description}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function Field({
  label,
  value,
}: {
  label: string
  value: React.ReactNode | string | null | undefined
}): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">
        {value === null || value === undefined || value === '' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function fullName(lead: { firstName?: string | null; lastName?: string | null }): string {
  const parts = [lead.firstName, lead.lastName].filter(Boolean) as string[]
  return parts.join(' ').trim() || 'Unnamed lead'
}

function prettyStatus(status: string | null | undefined): string | null {
  if (!status) return null
  return status.charAt(0) + status.slice(1).toLowerCase()
}

function prettyTier(tier: string | null | undefined): string | null {
  if (!tier) return null
  switch (tier) {
    case 'TIER_1':
      return 'Tier 1'
    case 'TIER_2':
      return 'Tier 2'
    case 'TIER_3':
      return 'Tier 3'
    default:
      return tier
  }
}

function formatCurrency(
  value: string | number | null | undefined,
  currency: string,
): string | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}
