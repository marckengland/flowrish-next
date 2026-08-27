'use client'

import {
  createContext,
  useCallback,
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
  Copy,
  Handshake,
  Mail,
  Maximize2,
  Minimize2,
  Phone,
  Plus,
  Trash2,
  Trophy,
  type LucideIcon,
} from 'lucide-react'
import {
  EditorRenderer,
  FreeLayoutEditorProvider,
  useNodeRender,
  WorkflowPortRender,
  type FreeLayoutProps,
  type FreeLayoutPluginContext,
  type WorkflowJSON,
  type WorkflowNodeEntity,
  type WorkflowNodeRegistry,
} from '@flowgram.ai/free-layout-editor'
import '@flowgram.ai/free-layout-editor/index.css'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  deleteStep,
  duplicateStep,
  reorderSteps,
  saveCadenceLayout,
} from '@/server/actions/cadences'
import { StepEditor } from '@/components/cadences/step-editor'
import type {
  CadenceStep,
  CanvasLayout,
  CanvasNodePosition,
  StepActionType,
} from '@/hooks/use-cadences'

/**
 * Visual, node-based cadence builder backed by flowgram.ai's FREE-layout
 * editor (n8n-style). Users can:
 *   - drag step nodes anywhere on an infinite canvas
 *   - draw a connection from one node's output port to the next node's
 *     input port to wire the send order
 *   - delete a connection to unwire, then re-draw it differently
 *   - click a step to edit it, or delete it from the node
 *
 * IMPORTANT — the executor contract is preserved. The Inngest runner still
 * reads a strictly linear, contiguous `CadenceStep.stepOrder`. This canvas
 * DERIVES that order from the single Start→End connection chain: whenever
 * the wiring forms one clean line through every step, the new order is
 * persisted through the same `reorderSteps` server action the list builder
 * uses. Node positions are cosmetic and saved separately via
 * `saveCadenceLayout`. If the graph is not a clean single line (a branch, a
 * gap, a stray edge), the last valid order stays in effect and the UI asks
 * the user to reconnect — the canvas can never produce a shape the data
 * model can't run.
 */

const START_NODE_ID = 'start'
const END_NODE_ID = 'end'
const STEP_NODE_TYPE = 'cadenceStep'

// Auto-layout spacing when a node has no saved position yet (horizontal,
// left-to-right like n8n).
const AUTO_X_GAP = 320
const AUTO_Y = 200
const STEP_W = 288
const STEP_H = 96
const MARKER_W = 132
const MARKER_H = 44

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

/** Quick-add palette entries — one per step action type. */
const ADD_PALETTE: ReadonlyArray<{
  type: StepActionType
  label: string
  icon: LucideIcon
}> = [
  { type: 'EMAIL', label: 'Email', icon: Mail },
  { type: 'CALL', label: 'Call', icon: Phone },
  { type: 'LINKEDIN', label: 'LinkedIn', icon: Handshake },
  { type: 'MANUAL_TASK', label: 'Task', icon: ClipboardList },
]

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

// ─── Shared handlers / lookup for nodes rendered inside the editor ───────────

interface CanvasContextValue {
  readOnly: boolean
  stepsById: Map<string, CadenceStep>
  onEdit: (stepId: string) => void
  onDelete: (stepId: string) => void
  onDuplicate: (stepId: string) => void
}

const CanvasContext = createContext<CanvasContextValue | null>(null)

function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext)
  if (!ctx) throw new Error('CanvasContext missing')
  return ctx
}

// ─── Document build + order derivation ───────────────────────────────────────

interface FlowEdge {
  sourceNodeID: string
  targetNodeID: string
}

/**
 * Builds the flowgram document from the ordered steps and saved layout.
 * Positions come from the saved layout when present, otherwise nodes are
 * auto-arranged left-to-right. Edges are the current linear chain
 * (Start → step[0] → … → End) so the canvas opens wired in send order.
 */
function buildDocument(
  steps: readonly CadenceStep[],
  layout: CanvasLayout | undefined,
): WorkflowJSON {
  const pos = (id: string, autoIndex: number): CanvasNodePosition =>
    layout?.positions?.[id] ?? { x: autoIndex * AUTO_X_GAP, y: AUTO_Y }

  const nodes: WorkflowJSON['nodes'] = [
    {
      id: START_NODE_ID,
      type: 'start',
      meta: { position: pos(START_NODE_ID, 0) },
      data: { title: 'Start' },
    },
    ...steps.map((s, i) => ({
      id: s.id,
      type: STEP_NODE_TYPE,
      meta: { position: pos(s.id, i + 1) },
      data: { title: ACTION_META[s.actionType].label },
    })),
    {
      id: END_NODE_ID,
      type: 'end',
      meta: { position: pos(END_NODE_ID, steps.length + 1) },
      data: { title: 'End' },
    },
  ]

  const chain = [START_NODE_ID, ...steps.map((s) => s.id), END_NODE_ID]
  const edges: FlowEdge[] = chain.slice(0, -1).map((sourceNodeID, i) => ({
    sourceNodeID,
    targetNodeID: chain[i + 1],
  }))

  return { nodes, edges }
}

/**
 * Derives the linear send order from the connection graph. Returns the
 * ordered step ids when the edges form exactly one clean line from Start
 * through every step to End; otherwise returns null (branch, gap, cycle,
 * or a stray edge), which means "don't touch the order".
 */
function deriveLinearOrder(
  edges: readonly FlowEdge[],
  stepIds: readonly string[],
): string[] | null {
  // A clean single chain has exactly one edge per hop: start→…→end.
  if (edges.length !== stepIds.length + 1) return null

  const outgoing = new Map<string, string[]>()
  for (const e of edges) {
    const arr = outgoing.get(e.sourceNodeID) ?? []
    arr.push(e.targetNodeID)
    outgoing.set(e.sourceNodeID, arr)
  }

  const stepIdSet = new Set(stepIds)
  const order: string[] = []
  const visited = new Set<string>()
  let current = START_NODE_ID

  // Follow the single outgoing edge from each node until we reach End.
  for (let guard = 0; guard <= stepIds.length + 1; guard++) {
    const nexts = outgoing.get(current) ?? []
    if (nexts.length !== 1) return null
    const next = nexts[0]
    if (next === END_NODE_ID) {
      return order.length === stepIds.length ? order : null
    }
    if (!stepIdSet.has(next) || visited.has(next)) return null
    visited.add(next)
    order.push(next)
    current = next
  }
  return null
}

// ─── Node registries ─────────────────────────────────────────────────────────

function buildRegistries(readOnly: boolean): WorkflowNodeRegistry[] {
  const marker = { width: MARKER_W, height: MARKER_H }
  return [
    {
      type: 'start',
      meta: {
        isStart: true,
        deleteDisable: true,
        copyDisable: true,
        draggable: !readOnly,
        defaultPorts: [{ type: 'output' }],
        size: marker,
      },
    },
    {
      type: 'end',
      meta: {
        deleteDisable: true,
        copyDisable: true,
        draggable: !readOnly,
        defaultPorts: [{ type: 'input' }],
        size: marker,
      },
    },
    {
      type: STEP_NODE_TYPE,
      meta: {
        // Deletion is routed through the server action from the node's own
        // trash button so the canvas and DB never diverge.
        deleteDisable: true,
        copyDisable: true,
        draggable: !readOnly,
        defaultPorts: [{ type: 'input' }, { type: 'output' }],
        size: { width: STEP_W, height: STEP_H },
      },
    },
  ]
}

// ─── Node renderers ──────────────────────────────────────────────────────────

/** renderDefaultNode — branches on node type. */
function CanvasNode({ node }: { node: WorkflowNodeEntity }): React.JSX.Element | null {
  const render = useNodeRender()
  const { readOnly, stepsById, onEdit, onDelete, onDuplicate } = useCanvas()
  const id = node.id
  const ports = render.ports ?? []
  const portEls = ports.map((p) => <WorkflowPortRender key={p.id} entity={p} />)

  if (id === START_NODE_ID || id === END_NODE_ID) {
    const isStart = id === START_NODE_ID
    return (
      <>
        <div
          ref={render.nodeRef}
          draggable={!readOnly}
          onDragStart={render.startDrag}
          className="flex h-[44px] w-[132px] items-center justify-center gap-1.5 rounded-full border border-border bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {isStart ? (
            <Plus className="size-3.5" aria-hidden="true" />
          ) : (
            <Trophy className="size-3.5" aria-hidden="true" />
          )}
          {isStart ? 'Start' : 'End'}
        </div>
        {portEls}
      </>
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
    <>
      <div
        ref={render.nodeRef}
        draggable={!readOnly}
        onDragStart={render.startDrag}
        className={cn(
          'flex h-24 w-72 flex-col justify-between rounded-lg border bg-card p-3.5 text-left shadow-sm transition-colors',
          render.selected ? 'border-brand' : 'border-border',
          !readOnly && 'hover:border-foreground/30',
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
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
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={`Duplicate step ${step.stepOrder}`}
                title="Duplicate step"
                className="text-muted-foreground/60 hover:text-foreground"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onDuplicate(step.id)
                }}
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Delete step ${step.stepOrder}`}
                title="Delete step"
                className="text-muted-foreground/60 hover:text-danger-foreground"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(step.id)
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={readOnly}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            if (!readOnly) onEdit(step.id)
          }}
          className={cn(
            'block w-full truncate text-left text-xs text-muted-foreground',
            !readOnly &&
              'cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          )}
        >
          {preview ?? 'No content yet — click to edit'}
        </button>
      </div>
      {portEls}
    </>
  )
}

// ─── Editor host ─────────────────────────────────────────────────────────────

interface FlowCanvasProps {
  steps: readonly CadenceStep[]
  layout: CanvasLayout | undefined
  readOnly: boolean
  onReorder: (orderedStepIds: string[]) => void
  onLayout: (positions: Record<string, CanvasNodePosition>) => void
  onValidityChange: (valid: boolean) => void
}

function FlowCanvas({
  steps,
  layout,
  readOnly,
  onReorder,
  onLayout,
  onValidityChange,
}: FlowCanvasProps): React.JSX.Element {
  // Server-truth order, used to detect real reorders (onContentChange also
  // fires on load, drag, fitView, etc.).
  const orderRef = useRef<string[]>(steps.map((s) => s.id))
  useEffect(() => {
    orderRef.current = steps.map((s) => s.id)
  }, [steps])

  const stepIdsRef = useRef<string[]>(steps.map((s) => s.id))
  useEffect(() => {
    stepIdsRef.current = steps.map((s) => s.id)
  }, [steps])

  // Simple trailing debounce for the (chatty) content-change callback.
  const debounceRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  const registries = useMemo(() => buildRegistries(readOnly), [readOnly])

  const editorProps = useMemo<FreeLayoutProps>(
    () => ({
      background: true,
      readonly: readOnly,
      initialData: buildDocument(steps, layout),
      nodeRegistries: registries,
      // We render our own node content, so the form/node engine is off.
      nodeEngine: { enable: false },
      materials: {
        renderDefaultNode: CanvasNode,
      },
      /**
       * Prevent self-loops and cycles at connect time. Whole-graph
       * validation (single clean chain) happens in onContentChange; here we
       * just stop obviously-illegal links so the runner-safe shape holds.
       */
      canAddLine(_ctx, fromPort, toPort) {
        if (fromPort.node === toPort.node) return false
        return !fromPort.node.lines.allInputNodes.includes(toPort.node)
      },
      // Node deletion is routed through the server action (trash button), so
      // block the editor's own delete to keep canvas + DB in sync.
      canDeleteNode: () => false,
      // Lines can always be deleted — that's how the user "disconnects".
      canDeleteLine: () => true,
      onContentChange(ctx: FreeLayoutPluginContext) {
        if (readOnly) return
        if (debounceRef.current) window.clearTimeout(debounceRef.current)
        debounceRef.current = window.setTimeout(() => {
          if (ctx.document.disposed) return
          const json = ctx.document.toJSON() as WorkflowJSON

          // 1. Persist cosmetic positions.
          const positions: Record<string, CanvasNodePosition> = {}
          for (const n of json.nodes) {
            const p = n.meta?.position
            if (p && typeof p.x === 'number' && typeof p.y === 'number') {
              positions[n.id] = { x: p.x, y: p.y }
            }
          }
          onLayout(positions)

          // 2. Derive send order from the wiring.
          const edges = (json.edges ?? []) as FlowEdge[]
          const derived = deriveLinearOrder(edges, stepIdsRef.current)
          onValidityChange(derived !== null)
          if (derived) {
            const changed =
              derived.length !== orderRef.current.length ||
              derived.some((idv, i) => idv !== orderRef.current[i])
            if (changed) {
              orderRef.current = derived
              onReorder(derived)
            }
          }
        }, 600)
      },
      onAllLayersRendered(ctx: FreeLayoutPluginContext) {
        // A connection's path is computed from its two ports' MODEL anchor
        // points. The visual port dots position via CSS immediately, but the
        // model points stay stale (0,0) until each port measures its DOM —
        // which only happens after the node content has painted. Until then
        // the lines render invisible and would otherwise appear only once a
        // drag forces a transform recompute (exactly the symptom seen).
        //
        // So: re-validate every port (recomputes its anchor from the DOM)
        // and force the lines layer to redraw. Node content mounts over a
        // few frames, so retry on a short schedule — forceUpdate is cheap
        // and idempotent, so redundant passes are harmless.
        const refreshLines = (): void => {
          if (ctx.document.disposed) return
          // Recompute port anchors from the DOM, then each line's path from
          // its (now-correct) ports, then force the layer to redraw.
          ctx.document.getAllPorts().forEach((port) => port.validate())
          ctx.document.linesManager.getAllLines().forEach((line) => line.validate())
          ctx.document.linesManager.forceUpdate()
        }
        void ctx.tools.fitView(false)
        for (const delay of [0, 60, 150, 300, 600]) {
          setTimeout(() => requestAnimationFrame(refreshLines), delay)
        }
      },
    }),
    [steps, layout, registries, readOnly, onReorder, onLayout, onValidityChange],
  )

  return (
    <FreeLayoutEditorProvider {...editorProps}>
      <EditorRenderer className="size-full" />
    </FreeLayoutEditorProvider>
  )
}

// ─── Public component ────────────────────────────────────────────────────────

export interface CadenceCanvasProps {
  cadenceId: string
  initialSteps: readonly CadenceStep[]
  initialLayout?: CanvasLayout
  readOnly?: boolean
  hasLiveEnrollments?: boolean
}

export function CadenceCanvas({
  cadenceId,
  initialSteps,
  initialLayout,
  readOnly = false,
  hasLiveEnrollments = false,
}: CadenceCanvasProps): React.JSX.Element {
  const router = useRouter()
  const steps = useMemo(
    () => [...initialSteps].sort((a, b) => a.stepOrder - b.stepOrder),
    [initialSteps],
  )
  const stepsById = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps])

  const [editing, setEditing] = useState<
    | { mode: 'new'; actionType?: StepActionType }
    | { mode: 'edit'; stepId: string }
    | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [graphValid, setGraphValid] = useState(true)
  const [, startTransition] = useTransition()

  // flowgram initializes from `initialData` once; re-key it whenever the
  // server-side step list (order/content) changes so a refresh re-seeds.
  const signature = useMemo(
    () => steps.map((s) => `${s.id}:${s.stepOrder}:${s.updatedAt}`).join('|'),
    [steps],
  )

  // SSR gate — flowgram is a browser-only, DOM-heavy editor.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    if (!fullscreen) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const handleReorder = useCallback(
    (orderedStepIds: string[]): void => {
      setError(null)
      startTransition(async () => {
        const result = await reorderSteps(cadenceId, orderedStepIds)
        if (result && 'error' in result && result.error) {
          setError(result.error)
        }
        router.refresh()
      })
    },
    [cadenceId, router],
  )

  const handleLayout = useCallback(
    (positions: Record<string, CanvasNodePosition>): void => {
      // Cosmetic — fire-and-forget, no refresh.
      void saveCadenceLayout(cadenceId, positions)
    },
    [cadenceId],
  )

  const handleDelete = useCallback(
    (stepId: string): void => {
      setError(null)
      startTransition(async () => {
        const result = await deleteStep(cadenceId, stepId)
        if (result && 'error' in result && result.error) {
          setError(result.error)
          return
        }
        router.refresh()
      })
    },
    [cadenceId, router],
  )

  const handleDuplicate = useCallback(
    (stepId: string): void => {
      setError(null)
      startTransition(async () => {
        const result = await duplicateStep(cadenceId, stepId)
        if (result && 'error' in result && result.error) {
          setError(result.error)
          return
        }
        router.refresh()
      })
    },
    [cadenceId, router],
  )

  const editingStep =
    editing?.mode === 'edit' ? stepsById.get(editing.stepId) ?? null : null

  return (
    <section aria-label="Cadence flow" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Flow</h2>
          <p className="text-sm text-muted-foreground">
            {steps.length === 0
              ? 'No steps yet. Add one, then wire it from Start to End.'
              : 'Drag to arrange. Connect each step in one line from Start to End to set the send order.'}
          </p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing({ mode: 'new' })}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add step
          </Button>
        )}
      </header>

      {error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {error}
        </p>
      ) : null}

      {!readOnly && !graphValid && steps.length > 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-sm text-warning-foreground">
          These steps aren&apos;t connected in a single line from Start to End,
          so the send order is unchanged. Wire every step in one path to update
          the order.
        </p>
      ) : null}

      <div
        className={cn(
          'relative w-full overflow-hidden bg-card',
          fullscreen
            ? 'fixed inset-0 z-50 h-[100dvh] rounded-none border-0'
            : 'h-[min(680px,calc(100dvh-240px))] min-h-[440px] rounded-lg border',
        )}
      >
        <Link
          href="/cadences"
          className="absolute left-3 top-3 z-20 inline-flex items-center gap-1 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span>Back to cadences</span>
        </Link>

        <button
          type="button"
          onClick={() => setFullscreen((f) => !f)}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Open fullscreen'}
          title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
          className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-border bg-card/95 px-2.5 py-1.5 text-sm text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {fullscreen ? (
            <>
              <Minimize2 className="size-4" aria-hidden="true" />
              <span>Exit</span>
            </>
          ) : (
            <>
              <Maximize2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Fullscreen</span>
            </>
          )}
        </button>

        {/* Quick-add palette — a "component list" for dropping steps onto
            the flow. Clicking a type opens the editor pre-set to it; on save
            the new step auto-wires at the end of the chain, ready to drag /
            rewire. (Click-to-add is used over canvas drag-and-drop because
            it's reliable across pointer + touch and needs no drop-coordinate
            math against the canvas pan/zoom transform.) */}
        {!readOnly && (
          <div className="absolute left-3 top-14 z-20 flex w-36 flex-col gap-0.5 rounded-lg border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
            <span className="px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Add step
            </span>
            {ADD_PALETTE.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => setEditing({ mode: 'new', actionType: type })}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <span
                  className={cn(
                    'inline-flex size-6 shrink-0 items-center justify-center rounded-md',
                    ACTION_META[type].badgeClass,
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                {label}
              </button>
            ))}
          </div>
        )}

        {mounted ? (
          <CanvasContext.Provider
            value={{
              readOnly,
              stepsById,
              onEdit: (stepId) => setEditing({ mode: 'edit', stepId }),
              onDelete: handleDelete,
              onDuplicate: handleDuplicate,
            }}
          >
            <FlowCanvas
              // Re-key on step changes + fullscreen so flowgram re-inits and
              // re-runs fitView against the (new) viewport.
              key={`${signature}:${fullscreen ? 'fs' : 'box'}`}
              steps={steps}
              layout={initialLayout}
              readOnly={readOnly}
              onReorder={handleReorder}
              onLayout={handleLayout}
              onValidityChange={setGraphValid}
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
          defaultActionType={
            editing.mode === 'new' ? editing.actionType : undefined
          }
          canEdit
          canDelete={editing.mode === 'edit' && !hasLiveEnrollments}
          onClose={() => setEditing(null)}
          onSaved={() => router.refresh()}
          onDeleted={() => router.refresh()}
        />
      )}
    </section>
  )
}
