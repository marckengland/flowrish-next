'use client'

import Link from 'next/link'
import { DollarSign, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useKanbanStore } from '@/stores/kanban'

/**
 * Minimal lead shape needed to render a card on the Kanban board.
 *
 * The pipeline page loads leads via the leads service (RBAC-scoped) and
 * projects each row down to this shape so the board stays focused on what
 * a card actually needs — identity, name, deal value, score, and the
 * assignee for quick visual scanning.
 */
export interface KanbanCardLead {
  id: string
  firstName: string
  lastName: string
  dealValue: string | number | null
  currency: string
  score: number
  assignedUser?: { id: string; name: string } | null
}

export interface KanbanCardProps {
  lead: KanbanCardLead
  /** Whether the user may drag this card (requires `leads:write`). */
  draggable?: boolean
}

/**
 * A single lead card on the Kanban board.
 *
 * Displays the lead's name, deal value, score, and assignee, and — when
 * `draggable` — wires up HTML5 drag handlers that populate the Zustand
 * `kanban` store so every column knows which lead is moving. The card
 * itself is also a link to the lead detail page (task 22.2) so clicking
 * opens the lead without interfering with the drag gesture.
 *
 * Validates: Requirements 17.1, 17.2, 17.5, 26.4
 */
export function KanbanCard({
  lead,
  draggable = false,
}: KanbanCardProps): React.JSX.Element {
  const draggingLeadId = useKanbanStore((s) => s.draggingLeadId)
  const startDrag = useKanbanStore((s) => s.startDrag)
  const endDrag = useKanbanStore((s) => s.endDrag)

  const isDragging = draggingLeadId === lead.id

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>): void => {
    // Set the lead ID as the drag payload so drop targets can read it
    // even if another tab or page loses the store reference.
    event.dataTransfer.setData('text/plain', lead.id)
    event.dataTransfer.effectAllowed = 'move'
    startDrag(lead.id)
  }

  const handleDragEnd = (): void => {
    endDrag()
  }

  return (
    <div
      draggable={draggable || undefined}
      onDragStart={draggable ? handleDragStart : undefined}
      onDragEnd={draggable ? handleDragEnd : undefined}
      data-lead-id={lead.id}
      aria-grabbed={draggable ? isDragging : undefined}
      className={cn(
        'rounded-lg border bg-card p-3 shadow-sm transition-all',
        draggable && 'cursor-grab hover:shadow-md active:cursor-grabbing',
        isDragging && 'opacity-50 ring-2 ring-ring',
      )}
    >
      <Link
        href={`/leads/${lead.id}`}
        className="block text-sm font-medium leading-tight text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
        // Prevent the link from interfering with drag initiation — the
        // drag handler fires on the container, and the browser will still
        // navigate on a pure click.
        onDragStart={(e) => e.preventDefault()}
      >
        {fullName(lead)}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 tabular-nums">
          <DollarSign className="size-3" aria-hidden="true" />
          <span aria-label="Deal value">
            {formatCurrency(lead.dealValue, lead.currency)}
          </span>
        </span>

        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
            scoreBadgeClasses(lead.score),
          )}
          aria-label={`Lead score ${lead.score}`}
        >
          {lead.score}
        </span>

        {lead.assignedUser && (
          <span className="flex items-center gap-1">
            <User className="size-3" aria-hidden="true" />
            <span className="truncate">{lead.assignedUser.name}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Full-name helper — exported for tests and the board so both render the
 * same label when a lead has only one name field populated.
 */
export function fullName(
  lead: Pick<KanbanCardLead, 'firstName' | 'lastName'>,
): string {
  const parts = [lead.firstName, lead.lastName].filter(Boolean)
  return parts.join(' ').trim() || 'Unnamed lead'
}

/**
 * Formats a deal value using the provided currency. Accepts Prisma's
 * string-Decimal encoding as well as plain numbers; renders an em-dash
 * for null/undefined/unparseable inputs.
 */
export function formatCurrency(
  value: string | number | null | undefined,
  currency: string,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '—'
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

/**
 * Picks a badge color band for a lead score. Mirrors the banding used
 * elsewhere in the app (0–40 cold, 41–70 warm, 71+ hot).
 */
function scoreBadgeClasses(score: number): string {
  if (score >= 71) return 'bg-destructive/10 text-destructive'
  if (score >= 41) return 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
  return 'bg-muted text-muted-foreground'
}
