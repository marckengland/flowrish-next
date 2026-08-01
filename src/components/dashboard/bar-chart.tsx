import { cn } from '@/lib/utils'

export interface BarChartItem {
  label: string
  value: number
}

export interface BarChartProps {
  /** Title rendered above the chart. */
  title: string
  /** Items rendered as horizontal bars. Empty list shows an empty state. */
  items: readonly BarChartItem[]
  /** Optional value formatter (defaults to native `toString`). */
  formatValue?: (value: number) => string
  /** Optional extra class for the wrapper. */
  className?: string
}

/**
 * Horizontal bar chart used by the dashboard widgets (pipeline value
 * by stage, conversion rates, lead counts).
 *
 * Bars are scaled relative to the largest value in the set so a single
 * outlier doesn't compress the rest into invisibility. A minimum width
 * of 2% guarantees that small-but-non-zero values still draw something
 * the user can see.
 *
 * Pure presentational — accepts pre-computed items so the parent can
 * decide whether to fetch live or render from cached / server-rendered
 * data.
 */
export function BarChart({
  title,
  items,
  formatValue = (v) => String(v),
  className,
}: BarChartProps): React.JSX.Element {
  const max = Math.max(...items.map((i) => i.value), 1)

  return (
    <div className={cn('rounded-lg border bg-card p-[18px]', className)}>
      <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data available</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.label} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 text-[12.5px]">
                <span
                  className="min-w-0 truncate text-foreground"
                  title={item.label}
                >
                  {item.label}
                </span>
                <span className="shrink-0 tnum text-muted-foreground">
                  {formatValue(item.value)}
                </span>
              </div>
              <div
                className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-valuenow={item.value}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-label={`${item.label}: ${formatValue(item.value)}`}
              >
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{
                    width: `${Math.max((item.value / max) * 100, 2)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
