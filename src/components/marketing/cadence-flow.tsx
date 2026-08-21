import { Mail, Handshake, Phone, GripVertical, Plus } from 'lucide-react'

/**
 * Static, on-brand preview of the visual cadence flow editor shown in the
 * landing "Cadences" feature block.
 *
 * This is a faithful mini-version of the real product surface
 * (`src/components/cadences/cadence-canvas.tsx`): a single vertical chain of
 * Start -> step nodes -> End, with the same per-action icon colors, step
 * numbering, per-step delay line, content preview and "+" adders between
 * nodes. It is purely decorative (`aria-hidden`) — the neighbouring copy
 * carries the meaning for assistive tech.
 */

interface FlowNode {
  n: number
  icon: typeof Mail
  label: string
  badgeClass: string
  delay: string
  preview: string
  selected?: boolean
}

// Mirrors ACTION_META in cadence-canvas.tsx: Email = violet (AI accent),
// LinkedIn = blue, Call = indigo.
const NODES: readonly FlowNode[] = [
  {
    n: 1,
    icon: Mail,
    label: 'Email',
    badgeClass: 'bg-ai-subtle text-ai',
    delay: 'Immediately',
    preview: 'Quick question about {{company}}',
    selected: true,
  },
  {
    n: 2,
    icon: Handshake,
    label: 'LinkedIn',
    badgeClass: 'bg-blue-600/10 text-blue-600 dark:text-blue-400',
    delay: 'Wait 2 days',
    preview: 'Connect and reference the email',
  },
  {
    n: 3,
    icon: Phone,
    label: 'Call',
    badgeClass: 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400',
    delay: 'Wait 3 days',
    preview: 'Discovery call attempt',
  },
]

export function CadenceFlow(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border bg-card shadow-[0_30px_70px_-40px_rgba(0,0,0,0.35)]"
    >
      {/* editor toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-[13px] font-semibold">New business · Outbound</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-1 text-[11px] font-semibold text-brand-emphasis">
          <span className="size-1.5 rounded-full bg-brand" />
          Active
        </span>
      </div>

      {/* canvas — dotted node-editor backdrop */}
      <div
        className="flex flex-col items-center gap-0 px-6 py-7"
        style={{
          backgroundImage:
            'radial-gradient(var(--border) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      >
        <Pill>Start</Pill>
        {NODES.map((node) => (
          <div key={node.n} className="flex w-full flex-col items-center">
            <Connector />
            <NodeCard node={node} />
          </div>
        ))}
        <Connector />
        <Pill>End</Pill>
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-full border border-border bg-muted px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

/** Vertical connector with the flow editor's "+" insert affordance. */
function Connector(): React.JSX.Element {
  return (
    <div className="flex h-9 flex-col items-center justify-center">
      <span className="h-2.5 w-px bg-border" />
      <span className="flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground/60">
        <Plus className="size-3" aria-hidden="true" />
      </span>
      <span className="h-2.5 w-px bg-border" />
    </div>
  )
}

function NodeCard({ node }: { node: FlowNode }): React.JSX.Element {
  const Icon = node.icon
  return (
    <div
      className={
        node.selected
          ? 'w-full max-w-[288px] rounded-lg border border-brand bg-card p-3.5 shadow-[0_6px_18px_-10px_var(--brand)]'
          : 'w-full max-w-[288px] rounded-lg border border-border bg-card p-3.5 shadow-sm'
      }
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md ${node.badgeClass}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">
            {node.n}. {node.label}
          </p>
          <p className="text-[11px] text-muted-foreground">{node.delay}</p>
        </div>
        <GripVertical
          className="size-4 shrink-0 text-muted-foreground/40"
          aria-hidden="true"
        />
      </div>
      <p className="mt-2 truncate text-[11.5px] text-muted-foreground">
        {node.preview}
      </p>
    </div>
  )
}
