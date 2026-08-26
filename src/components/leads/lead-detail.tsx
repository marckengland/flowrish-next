'use client'

import { useState } from 'react'
import { Pencil, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScoreBadge } from '@/components/scoring/score-badge'
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
        className="flex flex-col gap-4 rounded-lg border bg-card p-[18px]"
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
      className="flex flex-col gap-4 rounded-lg border bg-card p-[18px]"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-13 shrink-0 items-center justify-center rounded-[14px] bg-foreground text-lg font-semibold text-background"
          >
            {initials(lead)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">
                {fullName(lead)}
              </h2>
              {lead.score != null ? (
                <ScoreBadge score={lead.score} size="md" />
              ) : null}
              {lead.stage?.name ? (
                <Badge variant="neutral" size="md">
                  {lead.stage.name}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {lead.title ? `${lead.title} · ` : ''}
              {lead.companyName ?? 'No company'}
            </p>
          </div>
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

      <dl className="grid grid-cols-1 gap-x-[18px] gap-y-4 text-sm sm:grid-cols-2">
        <Field label="Email" value={lead.email} />
        <Field label="Phone" value={lead.phone} />
        <Field
          label="Last activity"
          value={
            lead.lastActivityAt ? (
              <span suppressHydrationWarning>
                {formatRelative(lead.lastActivityAt)}
              </span>
            ) : null
          }
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
                className="text-brand-emphasis underline underline-offset-2"
              >
                {lead.linkedinUrl}
              </a>
            ) : null
          }
        />
      </dl>

      {lead.description ? (
        <div className="border-t pt-3.5">
          <h3 className="eyebrow mb-1.5">Description</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
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
  numeric = false,
}: {
  label: string
  value: React.ReactNode | string | null | undefined
  numeric?: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="eyebrow">{label}</dt>
      <dd
        className={
          numeric
            ? 'tnum text-sm font-semibold text-foreground'
            : 'min-w-0 break-words text-sm text-foreground'
        }
      >
        {value === null || value === undefined || value === '' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function initials(lead: {
  firstName?: string | null
  lastName?: string | null
}): string {
  const first = lead.firstName?.trim()?.[0] ?? ''
  const last = lead.lastName?.trim()?.[0] ?? ''
  const combined = `${first}${last}`.toUpperCase()
  return combined || '—'
}

function fullName(lead: { firstName?: string | null; lastName?: string | null }): string {
  const parts = [lead.firstName, lead.lastName].filter(Boolean) as string[]
  return parts.join(' ').trim() || 'Unnamed lead'
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
