const selector = 'a[href], area[href], input, select, textarea, button, iframe, object, embed, [tabindex], [contenteditable]:not([contenteditable="false"])'

/** Keyboard-reachable controls, including visible controls in fixed overlays. */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(element =>
    (element.tabIndex >= 0 || element.isContentEditable && !element.hasAttribute('tabindex')) && !element.matches(':disabled') &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0,
  )
}
