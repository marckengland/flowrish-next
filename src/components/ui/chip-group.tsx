'use client'

import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface ChipOption<T extends string> {
  value: T
  label: string
  /** Optional leading icon. */
  icon?: LucideIcon
  /** Icon tint applied when the chip is NOT selected. */
  iconClass?: string
  /**
   * Container classes (border/bg/text) applied when the chip IS selected.
   * Defaults to the brand tone so callers only override for semantic
   * outcomes (warning, danger, neutral, …).
   */
  selectedClass?: string
}

export interface ChipGroupProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<ChipOption<T>>
  /** Accessible name for the radiogroup. */
  ariaLabel: string
  className?: string
}

const DEFAULT_SELECTED =
  'border-brand/50 bg-brand-subtle text-brand-emphasis'

const UNSELECTED =
  'border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground'

/**
 * A single-select segmented chip row rendered as an accessible
 * `radiogroup` with roving tabindex + arrow-key navigation. Used wherever
 * a small, fixed enum (call outcome, activity type, …) reads better as
 * tappable chips than a native `<select>`.
 */
export function ChipGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: ChipGroupProps<T>): React.JSX.Element {
  function handleKeydown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      next = (index + 1) % options.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = (index - 1 + options.length) % options.length
    } else {
      return
    }
    e.preventDefault()
    onChange(options[next].value)
    const group = e.currentTarget.parentElement
    const target = group?.children[next] as HTMLElement | undefined
    target?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {options.map((opt, i) => {
        const selected = value === opt.value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => handleKeydown(e, i)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand/25',
              selected ? (opt.selectedClass ?? DEFAULT_SELECTED) : UNSELECTED,
            )}
          >
            {Icon && (
              <Icon
                className={cn('size-3.5', selected ? '' : opt.iconClass)}
                aria-hidden="true"
              />
            )}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
