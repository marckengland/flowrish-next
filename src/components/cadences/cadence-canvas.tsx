'use client'

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft,
  ClipboardList,
  GripVertical,
  Handshake,
  Mail,
  Phone,
  Plus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import {
  EditorRenderer,
  FixedLayoutEditorProvider,
  FlowRendererKey,
  useNodeRender,
  type FixedLayoutProps,
  type FixedLayoutPluginContext,
  type FlowDocumentJSON,
  type FlowNodeEntity,
  type FlowNodeRegistry,
} from '@flowgram.ai/fixed-layout-editor'
import '@flowgram.ai/fixed-layout-editor/index.css'

import { cn } from '@/lib/utils'
import { deleteStep, reorderSteps } from '@/server/actions/cadences'
import { StepEditor } from '@/components/cadences/step-editor'
import type { CadenceStep, StepActionType } from '@/hooks/use-cadences'

/**
 * Visual, node-based cadence builder backed by flowgram.ai's fixed-layout
 * editor. It renders the cadence's steps as a single vertical flow
 * (Start → step → step → … → End) and lets users:
 *   - click a step node to open the existing modal {@link StepEditor}
 *   - click the "+" between nodes to insert a new step at that position
 *   - drag a step node to reorder
 *   - delete a step from the node itself
 *
 * IMPORTANT — persistence is unchanged. flowgram is used purely as the
 * interaction surface; every structural change is routed through the same
 * server actions the list builder uses (`addStep`/`updateStep`/
 * `deleteStep`/`reorderSteps`) and then `router.refresh()` re-seeds the
 * canvas from the server. flowgram never owns the source of truth, so the
 * strictly-linear, contiguous `stepOrder` contract the Inngest executor
 * depends on is preserved. Branch/loop node types are deliberately NOT
 * registered, so the canvas cannot produce a shape the data model can't
 * represent.
 */

const START_NODE_ID = 'start'
const END_NODE_ID = 'end'
const STEP_NODE_TYPE = 'cadenceStep'

const ACTION_META: Record<
  StepActionType,
  { icon: LucideIcon; label: string; badgeClass: string }
> = {
  EMAIL: { icon: Mail, label: 'Email', badgeClass: 'bg-ai-subtle text-ai' },
  CALL: {
    icon: Phone,
    label: 'Call',
    badgeClass: 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400',
  },
  LINKEDIN: {
    icon: Handshake,
    label: 'LinkedIn',
    badgeClass: 'bg-info-subtle text-info',
  },
  MANUAL_TASK: {
    icon: ClipboardList,
    label: 'Manual task',
    badgeClass: 'bg-warning-subtle text-warning-foreground',
  },
}

function describeDelay(hours: number): string {
  if (hours <= 0) return 'Immediately'
  if (hours < 24) return `Wait ${hours}h`
  const days = Math.round(hours / 24)
  return `Wait ${days}d`
}

function bodyPreview(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Handlers + lookup shared with the flowgram-rendered node and adder
 * components (which live inside the editor provider and can't receive
 * props directly).
 */
interface CanvasContextValue {
  readOnly: boolean
  stepsById: Map<string, CadenceStep>
  onEdit: (stepId: string) => void
  onAddAfter: (afterNodeId: string) => void
  onDelete: (stepId: string) => void
}

const CanvasContext = createContext<CanvasContextValue | null>(null)

function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('CanvasContext missing')
  return ctx
}

/**
 * Builds the flowgram document from the ordered step list. The document
 * is always a single linear chain: a Start marker, one node per step in
 * `stepOrder`, then an End marker.
 */
function buildDocument(steps: readonly CadenceStep[]): FlowDocumentJSON {
  return {
    nodes: [
      { id: START_NODE_ID, type: 'start', data: { title: 'Start' } },
      ...steps.map((s) => ({
        id: s.id,
        type: STEP_NODE_TYPE,
        data: { title: ACTION_META[s.actionType].label },
      })),
      { id: END_NODE_ID, type: 'end', data: { title: 'End' } },
    ],
  }
}

/** Node renderer for every node type; branches on the node id/type. */
function CanvasNode(): React.JSX.Element | null {
  const { node, startDrag, dragging } = useNodeRender()
  const { readOnly, stepsById, onEdit, onDelete } = useCanvas()
  const id = node.id

  if (id === START_NODE_ID) {
    return (
      <div className="rounded-full border border-border bg-muted px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Start
      </div>
    )
  }
  if (id === END_NODE_ID) {
    return (
      <div className="rounded-full border border-border bg-muted px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        End
      </div>
    )
  }

  const step = stepsById.get(id)
  if (!step) return null

  const meta = ACTION_META[step.actionType]
  const Icon = meta.icon
  const preview = step.emailSubject
    ? step.emailSubject
    : step.taskTitle
      ? step.taskTitle
      : step.emailBody
        ? bodyPreview(step.emailBody)
        : null

  return (
    <div
      className={cn(
        'w-72 rounded-lg border bg-card p-3.5 text-left shadow-sm transition-colors',
        dragging ? 'border-brand opacity-40' : 'border-border',
        !readOnly && 'hover:border-foreground/30',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-md',
            meta.badgeClass,
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {step.stepOrder}. {meta.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {describeDelay(step.delayHours)}
          </p>
        </div>
        {!readOnly && (
          <>
            <button
              type="button"
              aria-label="Drag to reorder"
              className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
              onMouseDown={(e) => {
                startDrag(e)
                e.stopPropagation()
              }}
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Delete step ${step.stepOrder}`}
              className="text-muted-foreground/60 hover:text-danger-foreground"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(step.id)
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => !readOnly && onEdit(step.id)}
        className={cn(
          'mt-2 block w-full truncate text-left text-xs text-muted-foreground',
          !readOnly &&
            'cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        )}
      >
        {preview ?? 'No content yet — click to edit'}
      </button>
    </div>
  )
}

/**
 * Custom "+" adder rendered in the gap after `from`. Instead of letting
 * flowgram insert a node into its own document, it opens the step editor;
 * the resulting server-side add + reorder re-seeds the canvas.
 */
function CanvasAdder(props: {
  from: FlowNodeEntity
  to?: FlowNodeEntity
  hoverActivated: boolean
}): React.JSX.Element | null {
  const { readOnly, onAddAfter } = useCanvas()
  if (readOnly) return null
  // No adder after the End marker.
  if (props.from.id === END_NODE_ID) return null
  return (
    <button
      type="button"
      aria-label="Add step here"
      onClick={() => onAddAfter(props.from.id)}
      className={cn(
        'flex items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-all hover:border-brand hover:text-brand',
        props.hoverActivated ? 'size-6' : 'size-4',
      )}
    >
      <Plus className={props.hoverActivated ? 'size-4' : 'size-3'} aria-hidden="true" />
    </button>
  )
}

/**
 * The fixed-drag plugin eagerly resolves a DRAG_NODE renderer on ready and
 * the drag indicators once a drag begins. The bundled defaults live in the
 * Semi Design materials package, which we don't use — so we supply small,
 * dependency-free equivalents. Without these, flowgram throws
 * "Unknown render key drag-node".
 */
function DragNodePreview(): React.JSX.Element {
  return (
    <div className="rounded-md border border-brand bg-card px-3 py-1.5 text-xs font-medium shadow-md">
      Moving step…
    </div>
  )
}

function DragDropIndicator(): React.JSX.Element {
  return <div className="h-1 w-16 rounded-full bg-brand/70" aria-hidden="true" />
}

interface FlowCanvasProps {
  steps: readonly CadenceStep[]
  readOnly: boolean
  onReorder: (orderedStepIds: string[]) => void
}

/**
 * The flowgram provider + renderer. Kept as its own component so the
 * parent can force a clean re-init (fresh `initialData`) by changing its
 * `key` whenever the server-side step list changes.
 */
function FlowCanvas({
  steps,
  readOnly,
  onReorder,
}: FlowCanvasProps): React.JSX.Element {
  // The server-truth order of step ids, used to detect real reorders in
  // onContentChange (which also fires on load, expand, fitView, etc.).
  const orderRef = useRef<string[]>(steps.map((s) => s.id))
  useEffect(() => {
    orderRef.current = steps.map((s) => s.id)
  }, [steps])

  // Only the custom step type needs registering. 'start' / 'end' / 'default'
  // are flowgram's built-in base registries — redefining a type whose
  // `extend` equals its own name (e.g. type:'start' extend:'start') creates
  // an infinite extend-resolution loop ("Maximum call stack size exceeded").
  const nodeRegistries: FlowNodeRegistry[] = useMemo(
    () => [
      {
        type: STEP_NODE_TYPE,
        extend: 'default',
        meta: { draggable: !readOnly, deleteDisable: true },
      },
    ],
    [readOnly],
  )

  const editorProps = useMemo<FixedLayoutProps>(
    () => ({
      background: true,
      readonly: readOnly,
      initialData: buildDocument(steps),
      nodeRegistries,
      // We render entirely from our own step lookup, so the node engine
      // (forms) is not needed.
      nodeEngine: { enable: false },
      materials: {
        renderDefaultNode: CanvasNode,
        components: {
          [FlowRendererKey.ADDER]: CanvasAdder,
          [FlowRendererKey.DRAG_NODE]: DragNodePreview,
          [FlowRendererKey.DRAGGABLE_ADDER]: DragDropIndicator,
          [FlowRendererKey.DRAG_HIGHLIGHT_ADDER]: DragDropIndicator,
        },
      },
      history: { enable: true, enableChangeNode: true },
      /**
       * Fires on any document mutation. We only care about drag-reorders:
       * derive the new order of step nodes and, if it actually changed
       * from server truth, persist it via `reorderSteps`.
       */
      onContentChange(ctx: FixedLayoutPluginContext) {
        if (readOnly) return
        const json = ctx.document.toJSON() as FlowDocumentJSON
        const known = new Set(orderRef.current)
        const nextOrder = json.nodes
          .map((n) => n.id)
          .filter((nid) => known.has(nid))
        if (nextOrder.length !== orderRef.current.length) return
        const changed = nextOrder.some((nid, i) => nid !== orderRef.current[i])
        if (changed) {
          // Optimistically adopt the new order so we don't re-fire for the
          // same drag; the server refresh will confirm it.
          orderRef.current = nextOrder
          onReorder(nextOrder)
        }
      },
      onAllLayersRendered(ctx: FixedLayoutPluginContext) {
        setTimeout(() => {
          void ctx.tools.fitView(false)
        }, 10)
      },
    }),
    [steps, nodeRegistries, readOnly, onReorder],
  )

  return (
    <FixedLayoutEditorProvider {...editorProps}>
      <EditorRenderer className="size-full" />
    </FixedLayoutEditorProvider>
  )
}

export interface CadenceCanvasProps {
  cadenceId: string
  initialSteps: readonly CadenceStep[]
  readOnly?: boolean
  hasLiveEnrollments?: boolean
}

export function CadenceCanvas({
  cadenceId,
  initialSteps,
  readOnly = false,
  hasLiveEnrollments = false,
}: CadenceCanvasProps): React.JSX.Element {
  const router = useRouter()
  const steps = useMemo(
    () => [...initialSteps].sort((a, b) => a.stepOrder - b.stepOrder),
    [initialSteps],
  )
  const stepsById = useMemo(
    () => new Map(steps.map((s) => [s.id, s])),
    [steps],
  )

  const [editing, setEditing] = useState<
    { mode: 'new'; afterNodeId: string } | { mode: 'edit'; stepId: string } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // flowgram initializes from `initialData` once; re-key it whenever the
  // server-side step list changes so a refresh re-seeds the canvas.
  const signature = useMemo(
    () => steps.map((s) => `${s.id}:${s.stepOrder}:${s.updatedAt}`).join('|'),
    [steps],
  )

  // SSR gate — flowgram is a browser-only, DI/DOM-heavy editor.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  function handleReorder(orderedStepIds: string[]): void {
    setError(null)
    startTransition(async () => {
      const result = await reorderSteps(cadenceId, orderedStepIds)
      if (result && 'error' in result && result.error) {
        setError(result.error)
      }
      router.refresh()
    })
  }

  function handleDelete(stepId: string): void {
    setError(null)
    startTransition(async () => {
      const result = await deleteStep(cadenceId, stepId)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  /**
   * After the editor creates a step (always appended at the end by the
   * service), move it into the slot the user clicked "+" on.
   */
  function handleNewStepSaved(saved: CadenceStep): void {
    const afterNodeId =
      editing?.mode === 'new' ? editing.afterNodeId : END_NODE_ID
    const currentIds = steps.map((s) => s.id)
    const insertAt =
      afterNodeId === START_NODE_ID
        ? 0
        : currentIds.indexOf(afterNodeId) + 1 || currentIds.length
    // If it's already going to the end, the append is correct — skip the
    // extra reorder round-trip.
    if (insertAt >= currentIds.length) return
    const nextOrder = [...currentIds]
    nextOrder.splice(insertAt, 0, saved.id)
    startTransition(async () => {
      const result = await reorderSteps(cadenceId, nextOrder)
      if (result && 'error' in result && result.error) {
        setError(result.error)
      }
      router.refresh()
    })
  }

  const editingStep =
    editing?.mode === 'edit' ? stepsById.get(editing.stepId) ?? null : null

  return (
    <section aria-label="Cadence flow" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Flow</h2>
          <p className="text-sm text-muted-foreground">
            {steps.length === 0
              ? 'No steps yet. Use the + on the canvas to add one.'
              : `${steps.length} step${steps.length === 1 ? '' : 's'} · drag to reorder, click a step to edit.`}
          </p>
        </div>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}

      <div className="relative h-[520px] w-full overflow-hidden rounded-lg border bg-card">
        {/* The flowgram canvas captures wheel/pan and fills the viewport, so
            the page-level "Back to cadences" link can scroll out of reach.
            Pin an always-visible exit directly onto the diagram. */}
        <Link
          href="/cadences"
          className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Back to cadences</span>
        </Link>
        {mounted ? (
          <CanvasContext.Provider
            value={{
              readOnly,
              stepsById,
              onEdit: (stepId) => setEditing({ mode: 'edit', stepId }),
              onAddAfter: (afterNodeId) =>
                setEditing({ mode: 'new', afterNodeId }),
              onDelete: handleDelete,
            }}
          >
            <FlowCanvas
              key={signature}
              steps={steps}
              readOnly={readOnly}
              onReorder={handleReorder}
            />
          </CanvasContext.Provider>
        ) : (
          <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
            Loading canvas…
          </div>
        )}
      </div>

      {editing && !readOnly && (
        <StepEditor
          cadenceId={cadenceId}
          step={editingStep}
          canEdit
          canDelete={editing.mode === 'edit' && !hasLiveEnrollments}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            if (editing.mode === 'new') handleNewStepSaved(saved)
          }}
          onDeleted={() => router.refresh()}
        />
      )}
    </section>
  )
}
