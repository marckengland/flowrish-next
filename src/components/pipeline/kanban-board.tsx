'use client'

import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { cn } from '@/lib/utils'
import { useKanbanStore } from '@/stores/kanban'
import { KanbanCard, formatCurrency, type KanbanCardLead } from './kanban-card'
import { leadsKeys, type LeadListItem, type LeadsPage } from '@/hooks/use-leads'

/**
 * Maximum leads pulled into the Kanban view in a single request. Kept
 * high enough to comfortably render every lead for typical mid-market
 * pipelines; when an org exceeds this we surface a "showing X of Y"
 * hint instead of silently truncating.
 */
const KANBAN_PAGE_SIZE = 200

/**
 * Stage shape needed to render a Kanban column. Each stage becomes one
 * column in the same order as it exists on the pipeline.
 */
export interface KanbanStage {
  id: string
  name: string
  order: number
  isClosedWon: boolean
  isClosedLost: boolean
}

export interface KanbanBoardProps {
  /** Stages to render as columns, in display order. */
  stages: readonly KanbanStage[]
  /**
   * Initial set of leads already loaded by the parent Server Component.
   * The board uses this as the TanStack Query initial cache so it paints
   * immediately and can refetch in the background.
   */
  initialLeads: readonly LeadListItem[]
  /** Total rows the server returned for the current access-scoped query. */
  totalLeads: number
  /**
   * Whether the current user may drag leads between stages. Tied to the
   * `leads:write` permission so view-only roles see a read-only board.
   */
  canMove: boolean
}

/**
 * Drag-and-drop Kanban board for the pipeline page.
 *
 * - Renders one column per pipeline stage, in order.
 * - Groups the RBAC-scoped leads into columns by `stageId`.
 * - Wires drag events through the Zustand `kanban` store so columns can
 *   highlight themselves while a drop is imminent.
 * - On drop, PATCHes `/api/leads/[id]/move` with the target stage ID and
 *   invalidates the leads cache so all views stay consistent.
 * - MEMBER view: only assigned leads are included in `initialLeads` (the
 *   server already RBAC-filters them). An empty board still renders every
 *   stage column so the user sees the whole pipeline (Requirement 17.4).
 *
 * Validates: Requirements 17.1, 17.2, 17.4, 17.5, 26.4
 */
export function KanbanBoard({
  stages,
  initialLeads,
  totalLeads,
  canMove,
}: KanbanBoardProps): React.JSX.Element {
  const queryClient = useQueryClient()

  // Match the query key the leads page uses so this view participates
  // in the same cache as the leads list. We fetch a large page because
  // the Kanban board needs to see every lead at once.
  const queryInput = useMemo(
    () => ({ filters: {}, page: 1, pageSize: KANBAN_PAGE_SIZE }),
    [],
  )

  const initialData = useMemo<LeadsPage>(
    () => ({
      data: [...initialLeads],
      pagination: {
        page: 1,
        pageSize: KANBAN_PAGE_SIZE,
        total: totalLeads,
        totalPages: Math.max(1, Math.ceil(totalLeads / KANBAN_PAGE_SIZE)),
      },
    }),
    [initialLeads, totalLeads],
  )

  const leadsQuery = useQuery({
    queryKey: leadsKeys.list(queryInput),
    queryFn: async (): Promise<LeadsPage> => {
      const res = await fetch(
        `/api/leads?page=1&pageSize=${KANBAN_PAGE_SIZE}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
        },
      )
      if (!res.ok) {
        let message = `Failed to load pipeline (${res.status})`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body.error?.message) message = body.error.message
        } catch {
          // ignore
        }
        throw new Error(message)
      }
      return (await res.json()) as LeadsPage
    },
    initialData,
  })

  const moveMutation = useMutation({
    mutationFn: async (vars: { leadId: string; toStageId: string }) => {
      const res = await fetch(`/api/leads/${vars.leadId}/move`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStageId: vars.toStageId }),
      })
      if (!res.ok) {
        let message = `Failed to move lead (${res.status})`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body.error?.message) message = body.error.message
        } catch {
          // ignore
        }
        throw new Error(message)
      }
      return vars
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadsKeys.all })
    },
  })

  const pagination = leadsQuery.data?.pagination
  const leads = useMemo(
    () => leadsQuery.data?.data ?? [],
    [leadsQuery.data],
  )

  const leadsByStage = useMemo(
    () => groupLeadsByStage(stages, leads),
    [stages, leads],
  )

  const isBusy = leadsQuery.isFetching || moveMutation.isPending
  const truncated =
    pagination !== undefined && pagination.total > pagination.pageSize

  return (
    <div className="flex flex-col gap-3">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center gap-2 text-xs text-muted-foreground transition-opacity',
          isBusy ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        <span>
          {moveMutation.isPending ? 'Moving lead…' : 'Updating…'}
        </span>
      </div>

      {moveMutation.isError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
          {(moveMutation.error as Error | undefined)?.message ??
            'Something went wrong moving that lead.'}
        </p>
      )}

      {truncated && pagination ? (
        <p
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          Showing {pagination.pageSize} of {pagination.total} leads.
          Use filters or the leads list to see the rest.
        </p>
      ) : null}

      <div
        className="flex gap-4 overflow-x-auto pb-4"
        aria-label="Pipeline Kanban board"
      >
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            leads={leadsByStage.get(stage.id) ?? []}
            canMove={canMove}
            onDropLead={(leadId) => {
              const lead = leads.find((l) => l.id === leadId)
              if (!lead) return
              if (lead.stageId === stage.id) return
              moveMutation.mutate({ leadId, toStageId: stage.id })
            }}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * A single column on the Kanban board, representing one pipeline stage.
 * The column is both a render target for its leads and a drop zone for
 * drag-and-drop moves.
 */
function StageColumn({
  stage,
  leads,
  canMove,
  onDropLead,
}: {
  stage: KanbanStage
  leads: readonly KanbanCardLead[]
  canMove: boolean
  onDropLead: (leadId: string) => void
}): React.JSX.Element {
  const draggingLeadId = useKanbanStore((s) => s.draggingLeadId)
  const dragOverStageId = useKanbanStore((s) => s.dragOverStageId)
  const setDragOverStage = useKanbanStore((s) => s.setDragOverStage)
  const endDrag = useKanbanStore((s) => s.endDrag)

  const isDragOver = canMove && dragOverStageId === stage.id && !!draggingLeadId

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!canMove) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverStageId !== stage.id) {
      setDragOverStage(stage.id)
    }
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!canMove) return
    // Only clear when the cursor actually leaves the column, not when
    // moving between children — `relatedTarget` being outside the column
    // is the reliable signal for that.
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) {
      return
    }
    if (dragOverStageId === stage.id) {
      setDragOverStage(null)
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!canMove) return
    event.preventDefault()
    setDragOverStage(null)
    const payloadId = event.dataTransfer.getData('text/plain')
    const leadId = payloadId || draggingLeadId
    endDrag()
    if (leadId) {
      onDropLead(leadId)
    }
  }

  const totalsByCurrency = sumByCurrency(leads)
  const totalLabel = formatTotalsByCurrency(totalsByCurrency)

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label={`${stage.name} stage column`}
      data-stage-id={stage.id}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/40 transition-shadow',
        isDragOver && 'ring-2 ring-ring ring-offset-1',
        stage.isClosedWon && 'border-emerald-500/30',
        stage.isClosedLost && 'border-destructive/30',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="truncate text-sm font-semibold">{stage.name}</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {totalLabel && (
            <span
              className="max-w-[10rem] truncate tabular-nums"
              aria-label="Stage total value"
              title={totalLabel}
            >
              {totalLabel}
            </span>
          )}
          <span
            className="rounded-full bg-muted px-2 py-0.5 font-medium"
            aria-label={`${leads.length} leads`}
          >
            {leads.length}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <KanbanCard key={lead.id} lead={lead} draggable={canMove} />
        ))}
        {leads.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No leads
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Sums lead deal values grouped by currency. Returned as a Map keyed by
 * ISO currency code so the header can render each currency separately —
 * summing €500k and $500k as one number would be nonsense.
 *
 * Exported for test coverage.
 */
export function sumByCurrency(
  leads: readonly Pick<KanbanCardLead, 'dealValue' | 'currency'>[],
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const lead of leads) {
    if (lead.dealValue === null || lead.dealValue === undefined) continue
    const n =
      typeof lead.dealValue === 'number'
        ? lead.dealValue
        : Number(lead.dealValue)
    if (!Number.isFinite(n) || n === 0) continue
    const currency = lead.currency || 'USD'
    totals.set(currency, (totals.get(currency) ?? 0) + n)
  }
  return totals
}

/**
 * Renders a compact multi-currency total. When every lead shares one
 * currency the output is the plain formatted number; when currencies
 * differ we render up to two of them separated by " · " with a "+N"
 * suffix if more currencies are present, so the column header stays
 * readable at 288px wide.
 */
function formatTotalsByCurrency(totals: Map<string, number>): string {
  const entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return ''
  if (entries.length === 1) {
    const [currency, amount] = entries[0]!
    return formatCurrency(amount, currency)
  }
  const visible = entries.slice(0, 2).map(([c, v]) => formatCurrency(v, c))
  const extra = entries.length - visible.length
  return visible.join(' · ') + (extra > 0 ? ` · +${extra}` : '')
}

/**
 * Groups leads by `stageId` into a map keyed by each stage's ID. Stages
 * with no leads still appear in the map with an empty array so every
 * column renders. Leads whose stage is not in the provided stage list
 * (defensive — shouldn't happen within a single pipeline) are dropped.
 *
 * Exported for test coverage.
 */
export function groupLeadsByStage(
  stages: readonly KanbanStage[],
  leads: readonly LeadListItem[],
): Map<string, KanbanCardLead[]> {
  const map = new Map<string, KanbanCardLead[]>()
  for (const stage of stages) {
    map.set(stage.id, [])
  }
  for (const lead of leads) {
    const bucket = map.get(lead.stageId)
    if (!bucket) continue
    bucket.push({
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      dealValue: lead.dealValue,
      currency: lead.currency,
      score: lead.score,
      assignedUser: lead.assignedUser
        ? { id: lead.assignedUser.id, name: lead.assignedUser.name }
        : null,
    })
  }
  return map
}
