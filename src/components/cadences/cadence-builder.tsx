'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Handshake,
  Mail,
  Pencil,
  Phone,
  Plus,
  type LucideIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { reorderSteps } from '@/server/actions/cadences'
import { StepEditor } from '@/components/cadences/step-editor'
import type { CadenceStep, StepActionType } from '@/hooks/use-cadences'

/**
 * Cadence step builder.
 *
 * Renders the step list grouped by execution day (computed from the
 * cumulative `delayHours` of each step) and lets the user:
 *   - click a step to open the modal editor (edit subject/body, change
 *     action type, swap delay unit, delete)
 *   - click "Add step" to open the editor in create mode
 *   - reorder steps with the keyboard-accessible up/down buttons
 *
 * When `readOnly` is set (the cadence is ARCHIVED) all mutating
 * affordances are hidden — server actions reject changes anyway, but the
 * UI shouldn't dangle controls that won't work.
 *
 * The builder owns its own copy of the step list so adds, edits, deletes,
 * and reorders can apply optimistically; a server failure reverts to the
 * last good snapshot. `router.refresh()` is still issued so any other
 * surface that reads cadence steps stays in lockstep.
 *
 * Validates: Requirements 6.4, 6.10, 32.1
 */

export interface CadenceBuilderProps {
  cadenceId: string
  initialSteps: readonly CadenceStep[]
  /** Hide all edit/add/reorder controls. */
  readOnly?: boolean
  /**
   * When true, deletion is blocked client-side. The server will also
   * block it (delete-step service rejects when ACTIVE/PAUSED enrollments
   * exist), but hiding the trash icon avoids a surprising rejection.
   */
  hasLiveEnrollments?: boolean
}

interface DayGroup {
  day: number
  steps: CadenceStep[]
}

const STEP_ICON_MAP: Record<StepActionType, {
  icon: LucideIcon
  label: string
  badgeClass: string
}> = {
  // Per-step-type icon colors per the design handoff: Email = violet
  // (AI accent), LinkedIn = blue, Call = indigo, Manual task = amber.
  EMAIL: {
    icon: Mail,
    label: 'Email',
    badgeClass: 'bg-ai-subtle text-ai',
  },
  CALL: {
    icon: Phone,
    label: 'Call',
    badgeClass: 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400',
  },
  LINKEDIN: {
    icon: Handshake,
    label: 'LinkedIn',
    badgeClass: 'bg-blue-600/10 text-blue-600 dark:text-blue-400',
  },
  MANUAL_TASK: {
    icon: ClipboardList,
    label: 'Manual task',
    badgeClass: 'bg-warning-subtle text-warning-foreground',
  },
}

export function CadenceBuilder({
  cadenceId,
  initialSteps,
  readOnly = false,
  hasLiveEnrollments = false,
}: CadenceBuilderProps): React.JSX.Element {
  const router = useRouter()
  const [steps, setSteps] = useState<readonly CadenceStep[]>(() =>
    [...initialSteps].sort((a, b) => a.stepOrder - b.stepOrder),
  )
  const [editing, setEditing] = useState<
    { mode: 'new' } | { mode: 'edit'; stepId: string } | null
  >(null)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [isReordering, startReorder] = useTransition()

  const dayGroups = useMemo(() => groupStepsByDay(steps), [steps])
  const editingStep = editing?.mode === 'edit'
    ? steps.find((s) => s.id === editing.stepId) ?? null
    : null

  function moveStep(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= steps.length) return

    const next = [...steps]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    // Optimistically renumber so the displayed order matches the post-save state.
    const renumbered = next.map((s, i) => ({ ...s, stepOrder: i + 1 }))
    setSteps(renumbered)
    setReorderError(null)

    startReorder(async () => {
      const result = await reorderSteps(
        cadenceId,
        renumbered.map((s) => s.id),
      )
      if (result && 'error' in result && result.error) {
        // Revert on failure so the server stays the source of truth.
        setSteps([...initialSteps].sort((a, b) => a.stepOrder - b.stepOrder))
        setReorderError(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleStepSaved(saved: CadenceStep): void {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === saved.id)
      if (idx === -1) {
        return [...prev, saved].sort((a, b) => a.stepOrder - b.stepOrder)
      }
      const next = [...prev]
      next[idx] = saved
      return next.sort((a, b) => a.stepOrder - b.stepOrder)
    })
  }

  function handleStepDeleted(stepId: string): void {
    setSteps((prev) =>
      prev
        .filter((s) => s.id !== stepId)
        // Renumber locally so the UI doesn't briefly show gaps; the
        // server's deleteStep also renumbers, so on the next refresh the
        // two converge.
        .map((s, i) => ({ ...s, stepOrder: i + 1 })),
    )
  }

  return (
    <section aria-label="Cadence steps" className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Steps</h2>
          <p className="text-sm text-muted-foreground">
            {steps.length === 0
              ? 'No steps yet. Add one to get started.'
              : `${steps.length} step${steps.length === 1 ? '' : 's'} in this cadence.`}
            {!readOnly && steps.length > 0 ? (
              <span className="ml-1 text-xs text-muted-foreground">
                Click a step to edit it.
              </span>
            ) : null}
          </p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing({ mode: 'new' })}
            disabled={isReordering}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>Add step</span>
          </Button>
        )}
      </header>

      {reorderError ? (
        <p role="alert" className="text-sm text-destructive">
          {reorderError}
        </p>
      ) : null}

      {steps.length === 0 ? (
        <EmptyStepsState readOnly={readOnly} />
      ) : (
        <div className="flex flex-col gap-4">
          {dayGroups.map((group) => (
            <div key={group.day} className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="eyebrow font-semibold">Day {group.day}</span>
                <div className="h-px flex-1 bg-border" aria-hidden="true" />
              </div>
              <ol className="flex flex-col gap-2">
                {group.steps.map((step) => {
                  const globalIndex = steps.findIndex((s) => s.id === step.id)
                  return (
                    <StepRow
                      key={step.id}
                      step={step}
                      index={globalIndex}
                      total={steps.length}
                      onMoveUp={() => moveStep(globalIndex, -1)}
                      onMoveDown={() => moveStep(globalIndex, 1)}
                      onSelect={() =>
                        !readOnly
                          && setEditing({ mode: 'edit', stepId: step.id })
                      }
                      reorderDisabled={readOnly || isReordering}
                      selectable={!readOnly}
                      isEditing={editingStep?.id === step.id}
                    />
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
      )}

      {editing && !readOnly && (
        <StepEditor
          cadenceId={cadenceId}
          step={editingStep}
          canEdit
          canDelete={editing.mode === 'edit' && !hasLiveEnrollments}
          onClose={() => setEditing(null)}
          onSaved={handleStepSaved}
          onDeleted={handleStepDeleted}
        />
      )}
    </section>
  )
}

function EmptyStepsState({ readOnly }: { readOnly: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed bg-card px-4 py-6 text-sm">
      <p className="text-muted-foreground">
        A cadence needs at least one step before it can be activated.
      </p>
      {readOnly ? (
        <p className="text-xs text-muted-foreground">
          This cadence is archived and cannot be modified.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Use <span className="font-medium">Add step</span> above to add an
          email, call, LinkedIn, or manual task step.
        </p>
      )}
    </div>
  )
}

interface StepRowProps {
  step: CadenceStep
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onSelect: () => void
  reorderDisabled: boolean
  selectable: boolean
  isEditing: boolean
}

function StepRow({
  step,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onSelect,
  reorderDisabled,
  selectable,
  isEditing,
}: StepRowProps): React.JSX.Element {
  const meta = STEP_ICON_MAP[step.actionType]
  const Icon = meta.icon
  return (
    <li className="flex items-stretch gap-2">
      <button
        type="button"
        onClick={selectable ? onSelect : undefined}
        disabled={!selectable}
        aria-label={`Edit step ${step.stepOrder}`}
        className={cn(
          'group flex flex-1 flex-col gap-2 rounded-lg border bg-card p-3.5 text-left transition-colors',
          isEditing
            ? 'border-brand shadow-[0_6px_18px_-10px_var(--brand)]'
            : 'border-border',
          selectable
            ? 'cursor-pointer hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
            : 'cursor-default',
        )}
      >
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
              meta.badgeClass,
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold">{meta.label}</span>
          <span className="text-xs font-normal text-muted-foreground">
            · {describeDelay(step.delayHours)}
          </span>
          {isEditing ? (
            <Badge variant="brand" size="sm" className="ml-auto">
              Editing
            </Badge>
          ) : selectable ? (
            <span
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors group-hover:border-foreground/30 group-hover:text-foreground"
              aria-hidden="true"
            >
              <Pencil className="size-3" />
              Edit
            </span>
          ) : null}
        </span>
        {renderStepDetails(step)}
      </button>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={onMoveUp}
          disabled={reorderDisabled || index === 0}
          aria-label={`Move step ${step.stepOrder} up`}
        >
          <ArrowUp className="size-3" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={onMoveDown}
          disabled={reorderDisabled || index === total - 1}
          aria-label={`Move step ${step.stepOrder} down`}
        >
          <ArrowDown className="size-3" aria-hidden="true" />
        </Button>
      </div>
    </li>
  )
}

function renderStepDetails(step: CadenceStep): React.JSX.Element | null {
  if (step.actionType === 'EMAIL') {
    return (
      <span className="ml-[38px] block text-sm">
        {step.emailSubject ? (
          <span className="block font-medium text-foreground">
            {step.emailSubject}
          </span>
        ) : null}
        {step.emailBody ? (
          <span
            className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground"
            // Strip tags for the preview to avoid `<p>`s collapsing height.
            dangerouslySetInnerHTML={{ __html: bodyPreview(step.emailBody) }}
          />
        ) : (
          <span className="block text-xs italic text-muted-foreground">
            No body configured yet.
          </span>
        )}
        {step.startNewThread ? (
          <Badge
            variant="warning"
            size="sm"
            className="mt-1.5 font-mono uppercase tracking-wide"
            title="This step starts a new Gmail thread instead of replying on the cadence's existing conversation."
          >
            New thread
          </Badge>
        ) : null}
      </span>
    )
  }
  if (step.taskTitle) {
    return (
      <span className="ml-[38px] block text-sm text-muted-foreground">
        {step.taskTitle}
      </span>
    )
  }
  return null
}

function bodyPreview(html: string): string {
  // Cheap "render-as-text" — drops tags but keeps whitespace so the
  // preview line breaks naturally on multi-paragraph bodies.
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function describeDelay(hours: number): string {
  if (hours <= 0) return 'Immediately'
  if (hours < 24) return `Wait ${hours}h`
  const days = Math.round(hours / 24)
  return `Wait ${days}d`
}

/**
 * Groups steps by the day on which they execute. The day is derived
 * from the cumulative `delayHours` of each step from the start of the
 * cadence — so a step with delay 0 lands on day 1, a step with delay 24
 * lands on day 2, etc. Mirrors the original frontend's "Day N" timeline.
 */
function groupStepsByDay(
  steps: readonly CadenceStep[],
): readonly DayGroup[] {
  if (steps.length === 0) return []
  const groups: DayGroup[] = []
  let cumulativeHours = 0
  for (const step of steps) {
    cumulativeHours += step.delayHours
    const day = Math.max(1, Math.ceil(cumulativeHours / 24) || 1)
    const existing = groups.find((g) => g.day === day)
    if (existing) {
      existing.steps.push(step)
    } else {
      groups.push({ day, steps: [step] })
    }
  }
  return groups
}
