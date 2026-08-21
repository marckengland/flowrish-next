import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SortDir } from '@/lib/table-sort'

/**
 * Shared data-table primitives.
 *
 * Every list table in the app (leads, companies, contacts, cadences, …) was
 * hand-rolling its own wrapper, header background, cell padding, font size,
 * and empty/error rows, which had drifted apart. These primitives encode one
 * canonical treatment so the tables stay visually consistent:
 *
 *   - wrapper: `overflow-x-auto rounded-lg border bg-card` (scrolls on mobile)
 *   - header:  `bg-muted/40`, eyebrow-styled cells, `px-4 py-3`
 *   - body:    `divide-y divide-row-divider`
 *   - rows:    hover/focus highlight for stretched-link rows
 *
 * `minWidth` stays per-table because column counts differ; everything else is
 * standardized here.
 */

export function Table({
  minWidth = 640,
  className,
  children,
}: {
  /** Minimum table width before the wrapper scrolls horizontally. */
  minWidth?: number
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table
        className={cn('w-full text-sm', className)}
        style={{ minWidth: `${minWidth}px` }}
      >
        {children}
      </table>
    </div>
  )
}

export function TableHead({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <thead className="border-b bg-muted/40 text-left">
      <tr>{children}</tr>
    </thead>
  )
}

export function Th({
  align = 'left',
  className,
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right'
}): React.JSX.Element {
  return (
    <th
      scope="col"
      className={cn('eyebrow px-4 py-3', align === 'right' && 'text-right', className)}
      {...props}
    >
      {children}
    </th>
  )
}

/**
 * A header cell whose label is a sort toggle. Reports `aria-sort` and shows an
 * up/down/neutral affordance. Sorting itself is owned by the parent table
 * (client-side, on the current page) via `onSort` + the shared `sortByKey`.
 */
export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: string
  activeKey: string
  dir: SortDir
  onSort: (key: string) => void
  align?: 'left' | 'right'
}): React.JSX.Element {
  const active = activeKey === sortKey
  const ariaSort = active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('eyebrow px-4 py-3', align === 'right' && 'text-right')}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40',
          active && 'text-foreground',
          align === 'right' && 'ml-auto',
        )}
      >
        <span>{label}</span>
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="size-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="size-3" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-60" aria-hidden="true" />
        )}
      </button>
    </th>
  )
}

export function TableBody({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <tbody className="divide-y divide-row-divider">{children}</tbody>
}

export function Tr({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>): React.JSX.Element {
  return (
    <tr
      className={cn(
        'relative transition-colors hover:bg-background focus-within:bg-background',
        className,
      )}
      {...props}
    >
      {children}
    </tr>
  )
}

export function Td({
  align = 'left',
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right'
}): React.JSX.Element {
  return (
    <td
      className={cn('px-4 py-3', align === 'right' && 'text-right', className)}
      {...props}
    >
      {children}
    </td>
  )
}

/**
 * A full-width state row (empty or error) spanning every column. Keeps
 * empty/error messaging inside the table body so the header stays visible
 * and every table handles these states the same way.
 *
 * Two shapes:
 *   - pass `children` for a simple centered line (used for load errors)
 *   - pass `icon` / `title` / `description` / `action` for a designed empty
 *     state (used when a list has no rows)
 */
export function TableState({
  colSpan,
  tone = 'muted',
  icon,
  title,
  description,
  action,
  children,
}: {
  colSpan: number
  tone?: 'muted' | 'error'
  icon?: React.ReactNode
  title?: string
  description?: string
  action?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <tr>
      <td
        colSpan={colSpan}
        role={tone === 'error' ? 'alert' : undefined}
        className="px-4 py-12 text-center"
      >
        {children ? (
          <span
            className={cn(
              'text-sm',
              tone === 'error' ? 'text-danger-foreground' : 'text-muted-foreground',
            )}
          >
            {children}
          </span>
        ) : (
          <div className="mx-auto flex max-w-xs flex-col items-center gap-1.5">
            {icon ? (
              <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {icon}
              </span>
            ) : null}
            {title ? (
              <p className="text-sm font-medium text-foreground">{title}</p>
            ) : null}
            {description ? (
              <p className="text-xs text-muted-foreground">{description}</p>
            ) : null}
            {action ? <div className="mt-2">{action}</div> : null}
          </div>
        )}
      </td>
    </tr>
  )
}
