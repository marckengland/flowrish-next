'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface HelpTooltipProps {
  /** Tooltip text — kept short, plain prose. */
  text: string
  /** Optional class for the trigger icon. */
  className?: string
  /** Override the icon size. Defaults to 14px. */
  size?: number
  /** Accessible label for the trigger. Defaults to "Help". */
  label?: string
}

/**
 * Small inline tooltip used to add hover/focus help text next to fields
 * and labels. Hover and keyboard focus both expand the bubble; clicking
 * elsewhere or pressing Escape collapses it.
 *
 * Renders as a `<button>` so screen readers can reach the explanation
 * via Tab navigation — the previous frontend used `<span title>` which is
 * inaccessible to keyboard users.
 */
export function HelpTooltip({
  text,
  className,
  size = 14,
  label = 'Help',
}: HelpTooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [open])

  return (
    <span ref={ref as unknown as React.RefObject<HTMLSpanElement>} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <HelpCircle aria-hidden="true" style={{ width: size, height: size }} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-56 -translate-x-1/2 rounded-md border bg-popover px-2 py-1.5 text-xs leading-relaxed text-foreground shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  )
}
