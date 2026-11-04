'use client'

import Link from 'next/link'

import { cn } from '@/lib/utils'
import { useKanbanStore } from '@/stores/kanban'
import { Badge } from '@/components/ui/badge'
import { ScoreBadge } from '@/components/scoring/score-badge'

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
  disabled?: boolean
  /** The stage this card currently sits in (drives the move control). */
  currentStageId?: string
  /** All stages, in order — offered as move targets in the keyboard menu. */
  stages?: readonly { id: string; name: string }[]
  /** Keyboard/pointer alternative to drag-and-drop; moves the lead. */
  onMove?: (leadId: string, toStageId: string) => void
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
  disabled = false,
  currentStageId,
  stages,
  onMove,
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
      draggable={(draggable && !disabled) || undefined}
      onDragStart={draggable && !disabled ? handleDragStart : undefined}
      onDragEnd={draggable && !disabled ? handleDragEnd : undefined}
      data-lead-id={lead.id}
      aria-grabbed={draggable ? isDragging : undefined}
      className={cn(
        'rounded-[10px] border bg-card p-3 transition-all',
        draggable
          ? 'cursor-grab hover:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.2)] active:cursor-grabbing'
          : 'cursor-pointer hover:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.2)]',
        isDragging && 'border-brand shadow-lg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.id}`}
          className="block text-[13px] font-medium leading-tight text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
          // Prevent the link from interfering with drag initiation — the
          // drag handler fires on the container, and the browser will still
          // navigate on a pure click.
          onDragStart={(e) => e.preventDefault()}
        >
          {fullName(lead)}
        </Link>

        {isDragging && (
          <Badge variant="brand" size="sm" className="shrink-0">
            MOVING
          </Badge>
        )}
      </div>

      {lead.assignedUser && (
        <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">
          {lead.assignedUser.name}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span
          className="tnum text-xs font-semibold text-foreground"
          aria-label="Deal value"
        >
          {formatCurrency(lead.dealValue, lead.currency)}
        </span>
        <ScoreBadge score={lead.score} />
      </div>

      {/* Keyboard/pointer alternative to drag-and-drop. Screen-reader and
          keyboard users can move a lead without a drag gesture. */}
      {draggable && onMove && stages && stages.length > 1 ? (
        <div className="mt-2.5 border-t border-row-divider pt-2">
          <label htmlFor={`move-${lead.id}`} className="sr-only">
            Move {fullName(lead)} to stage
          </label>
          <select
            id={`move-${lead.id}`}
            value={currentStageId}
            disabled={disabled}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const to = e.target.value
              if (!disabled && to && to !== currentStageId) onMove(lead.id, to)
            }}
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11.5px] text-muted-foreground transition-[border-color,box-shadow] focus-visible:border-brand focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand/15"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id === currentStageId ? `In ${s.name}` : `Move to ${s.name}`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
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
