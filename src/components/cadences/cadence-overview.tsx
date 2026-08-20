'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { List, Workflow } from 'lucide-react'

import { cn } from '@/lib/utils'
import { CadenceBuilder } from '@/components/cadences/cadence-builder'
import type { CadenceStep } from '@/hooks/use-cadences'

/**
 * The flowgram canvas is a large, browser-only bundle. Load it lazily and
 * client-side only, so the default List view stays lightweight and the
 * editor is fetched only when a user opens the Flow view.
 */
const CadenceCanvas = dynamic(
  () => import('@/components/cadences/cadence-canvas').then((m) => m.CadenceCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] w-full items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground">
        Loading canvas…
      </div>
    ),
  },
)

/**
 * Overview tab wrapper that lets users switch between the classic step
 * list and the flowgram-powered visual flow. Both edit the same cadence
 * through the same server actions; the toggle is purely a view choice.
 */

type View = 'list' | 'flow'

export interface CadenceOverviewProps {
  cadenceId: string
  initialSteps: readonly CadenceStep[]
  readOnly?: boolean
  hasLiveEnrollments?: boolean
}

export function CadenceOverview({
  cadenceId,
  initialSteps,
  readOnly = false,
  hasLiveEnrollments = false,
}: CadenceOverviewProps): React.JSX.Element {
  const [view, setView] = useState<View>('list')

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Step view"
        className="inline-flex w-fit rounded-lg border bg-muted p-0.5"
      >
        {(
          [
            { value: 'list' as const, label: 'List', icon: List },
            { value: 'flow' as const, label: 'Flow', icon: Workflow },
          ]
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              view === value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {view === 'list' ? (
        <CadenceBuilder
          cadenceId={cadenceId}
          initialSteps={initialSteps}
          readOnly={readOnly}
          hasLiveEnrollments={hasLiveEnrollments}
        />
      ) : (
        <CadenceCanvas
          cadenceId={cadenceId}
          initialSteps={initialSteps}
          readOnly={readOnly}
          hasLiveEnrollments={hasLiveEnrollments}
        />
      )}
    </div>
  )
}
