'use client'

import { useEffect, type RefObject } from 'react'
import { focusableElements } from '@/lib/focus'

/**
 * Traps keyboard focus inside `containerRef` while `active` is true, matching
 * the behaviour of the `Dialog` primitive:
 *   - moves focus into the container on activate,
 *   - loops Tab / Shift+Tab at the container edges,
 *   - restores focus to the previously-focused element on deactivate.
 *
 * The container should be focusable (`tabIndex={-1}`) as a fallback for when
 * it holds no focusable children. Escape/close handling stays with the caller.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const previouslyFocused =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null

    // Move focus into the container.
    const first = focusableElements(container)[0]
    if (first) first.focus()
    else container.focus()

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return
      const panel = containerRef.current
      if (!panel) return
      const focusable = focusableElements(panel)

      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const firstEl = focusable[0]!
      const lastEl = focusable[focusable.length - 1]!
      const activeEl = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (activeEl === firstEl || !panel.contains(activeEl)) {
          event.preventDefault()
          lastEl.focus()
        }
      } else if (activeEl === lastEl || !panel.contains(activeEl)) {
        event.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [active, containerRef])
}
