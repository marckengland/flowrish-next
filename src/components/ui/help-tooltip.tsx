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
 * and labels.
 *
 * Implementation notes:
 *   - The bubble is **always rendered** so opening it doesn't trigger
 *     mount/unmount layout thrash. CSS drives visibility via the
 *     parent `group` Tailwind utility (`group-hover` / `group-focus-within`)
 *     so we don't churn React state on every hover event — that was the
 *     root cause of the "shaking" effect users reported (cursor hovers,
 *     React mounts the bubble, browser reflows, the icon shifts a pixel,
 *     `mouseleave` fires, React unmounts, repeat).
 *   - `pointer-events-none` on the bubble guarantees the cursor never
 *     interacts with the bubble itself, so moving the cursor between the
 *     icon and the bubble can't cause a flicker loop.
 *   - Click toggles a separate `pinned` state for keyboard / touch users.
 *     Click outside or Escape un-pins.
 *   - The bubble's width clamps to the viewport so it can't push out a
 *     horizontal scrollbar near the right edge of the page.
 */
export function HelpTooltip({
  text,
  className,
  size = 14,
  label = 'Help',
}: HelpTooltipProps): React.JSX.Element {
  const [pinned, setPinned] = useState(false)
  const id = useId()
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!pinned) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPinned(false)
    }
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setPinned(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [pinned])

  return (
    <span ref={ref} className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => setPinned((v) => !v)}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <HelpCircle aria-hidden="true" style={{ width: size, height: size }} />
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          // Always present in the DOM. We toggle opacity + visibility
          // (rather than mount/unmount) so the icon's surrounding
          // layout never reflows, which is what caused the shake.
          'pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2',
          'w-56 max-w-[calc(100vw-1rem)]',
          'rounded-md border bg-popover px-2 py-1.5 text-xs leading-relaxed text-foreground shadow-md',
          'opacity-0 invisible transition-opacity duration-100',
          'group-hover:opacity-100 group-hover:visible',
          'group-focus-within:opacity-100 group-focus-within:visible',
          pinned && 'opacity-100 visible',
        )}
      >
        {text}
      </span>
    </span>
  )
}
