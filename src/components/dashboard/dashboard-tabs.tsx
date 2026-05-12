'use client'

import type { ReactNode } from 'react'
import { Tabs } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

/**
 * One entry in the dashboard tab list.
 *
 * `visible` lets callers gate certain tabs (e.g. Manager-only "Team View"
 * and "Commit vs AI") without having to compute a separate `items` array
 * per role — the tabs simply don't render when `visible === false`.
 */
export interface DashboardTabItem {
  /** Stable value used as the tab identity (URL-safe slug recommended). */
  value: string
  /** Human-readable tab label. */
  label: string
  /** Panel content already rendered on the server. */
  content: ReactNode
  /** Defaults to true when omitted. */
  visible?: boolean
}

export interface DashboardTabsProps {
  items: readonly DashboardTabItem[]
  /** Which tab is active on first paint. Falls back to the first visible item. */
  defaultValue?: string
  className?: string
}

/**
 * Tabbed view used by the dashboard home page. The panels themselves are
 * Server Components that render into the `content` prop of each item —
 * this wrapper only owns the active-tab state so switching tabs remains
 * an instant client-side transition without refetching data.
 *
 * Uses Base UI's Tabs primitive (keyboard navigation, roving tabindex,
 * and `aria-selected` / `aria-controls` wiring come for free).
 *
 * Validates: Requirements 9.3, 28.7
 */
export function DashboardTabs({
  items,
  defaultValue,
  className,
}: DashboardTabsProps): React.JSX.Element {
  const visible = items.filter((it) => it.visible !== false)
  // Fall back to the first visible tab when `defaultValue` points at a
  // hidden tab (e.g. the URL contains `?tab=team` but the user no longer
  // has Manager access). Otherwise Tabs.Root would render nothing.
  const defaultIsVisible =
    defaultValue !== undefined
    && visible.some((it) => it.value === defaultValue)
  const initial = defaultIsVisible ? defaultValue : visible[0]?.value

  return (
    <Tabs.Root
      defaultValue={initial}
      className={cn('flex flex-col gap-4', className)}
    >
      <Tabs.List
        loopFocus
        className="flex flex-wrap items-center gap-1 border-b"
        aria-label="Dashboard sections"
      >
        {visible.map((it) => (
          <Tabs.Tab
            key={it.value}
            value={it.value}
            className={cn(
              // Button-like pill that sits above the bottom border of the list,
              // with an underline indicating the active tab.
              'relative -mb-px inline-flex h-9 items-center whitespace-nowrap rounded-t-md border border-b-0 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'data-[selected]:border-border data-[selected]:bg-card data-[selected]:text-foreground',
            )}
          >
            {it.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      {visible.map((it) => (
        <Tabs.Panel
          key={it.value}
          value={it.value}
          className="focus-visible:outline-none"
        >
          {it.content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  )
}
