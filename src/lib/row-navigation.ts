import type { MouseEvent } from 'react'

/**
 * Elements that own their own click behavior and must never trigger row
 * navigation (links, buttons, form controls, menu items).
 */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [role="menuitem"], [role="checkbox"]'

/**
 * Builds an `onClick` handler that navigates a table/list row to `href` when
 * the user clicks the row background — but NOT when they click an interactive
 * child (link, button, form control), use a modified/middle click (new tab or
 * window), or are selecting text.
 *
 * Pair it with a real `<Link>` on the row's primary cell so keyboard and
 * assistive-tech users, middle-click, and right-click "open in new tab" keep
 * working.
 *
 * This replaces the `before:absolute before:inset-0` stretched-link overlay,
 * which relied on `position: relative` on a `<tr>`. Table rows don't establish
 * a containing block for absolutely-positioned descendants in Safari, so every
 * row's overlay escaped its row and the last one painted captured every click
 * (e.g. all clicks landing on the final lead). A JS row click works
 * identically across browsers and doesn't overlay sibling cells.
 */
export function rowNavClick(
  navigate: (href: string) => void,
  href: string,
): (event: MouseEvent<HTMLElement>) => void {
  return (event) => {
    if (event.defaultPrevented) return
    // Only plain left-clicks navigate. Let modified/middle clicks fall through
    // so the browser's native new-tab/new-window behavior on the real <Link>
    // still works.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const target = event.target as HTMLElement | null
    if (target?.closest(INTERACTIVE_SELECTOR)) return
    // Don't hijack an in-progress text selection.
    const selection =
      typeof window !== 'undefined' ? window.getSelection?.() : null
    if (selection && selection.toString().length > 0) return
    navigate(href)
  }
}
