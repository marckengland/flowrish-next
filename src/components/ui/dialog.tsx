'use client'

import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface DialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean
  /** Called when the user dismisses the dialog (Escape, backdrop, ✕). */
  onClose: () => void
  /** Title shown in the header. */
  title: React.ReactNode
  /** Optional subtitle / supporting text under the title. */
  description?: React.ReactNode
  /** Body content. */
  children: React.ReactNode
  /** Optional footer (typically buttons). */
  footer?: React.ReactNode
  /** Width preset. Defaults to medium. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Optional extra class for the inner panel. */
  className?: string
  /**
   * When false, the backdrop click is ignored. Useful when the dialog
   * has unsaved state and the parent wants to manage dismissal itself.
   */
  closeOnBackdrop?: boolean
  /**
   * When false the header close button is hidden. Combined with
   * `closeOnBackdrop={false}` this makes the dialog dismissable only
   * through a caller-provided action (useful for confirm-required flows).
   */
  showCloseButton?: boolean
}

const SIZE_CLASSES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/**
 * Focusable element selector used by both the initial focus and the
 * focus-trap machinery. Includes controls that are actually reachable
 * with Tab; hidden or explicitly opted-out elements are excluded.
 */
const FOCUSABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/**
 * Reference-counted body scroll lock. Every open dialog increments the
 * counter and the first one to open captures the previous `overflow`
 * value; the last one to close restores it. This makes nested / stacked
 * dialogs safe — closing an inner dialog no longer re-releases the body
 * scroll before the outer one is done.
 */
let scrollLockCount = 0
let previousBodyOverflow: string | null = null

function acquireScrollLock(): void {
  if (typeof document === 'undefined') return
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLockCount += 1
}

function releaseScrollLock(): void {
  if (typeof document === 'undefined') return
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow ?? ''
    previousBodyOverflow = null
  }
}

/**
 * Modal dialog primitive. Replaces the ad-hoc `fixed inset-0 z-50` markup
 * scattered through the codebase with one accessible, dismissable surface
 * that handles:
 *   - Escape-to-close
 *   - backdrop click-to-close (opt-out via `closeOnBackdrop`)
 *   - full focus trap: Tab / Shift+Tab loop inside the panel
 *   - initial focus lands on the first focusable element
 *   - focus is restored to the invoking element on close
 *   - aria-modal + aria-labelledby (unique per instance) for screen readers
 *   - reference-counted body scroll lock so nested dialogs stay safe
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  closeOnBackdrop = true,
  showCloseButton = true,
}: DialogProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  // Escape-to-close + body scroll lock + focus restore.
  useEffect(() => {
    if (!open) return

    // Remember what was focused before we opened, so we can restore it
    // when the dialog closes.
    previousFocusRef.current =
      typeof document !== 'undefined'
        ? (document.activeElement as HTMLElement | null)
        : null

    acquireScrollLock()

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      releaseScrollLock()
      // Return focus to whatever the user was on before opening.
      const previous = previousFocusRef.current
      if (previous && typeof previous.focus === 'function') {
        // `preventScroll` avoids the page jumping around during restore.
        previous.focus({ preventScroll: true })
      }
    }
  }, [open, onClose])

  // Focus the first focusable element after open.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    if (first) {
      first.focus()
    } else {
      panel.focus()
    }
  }, [open])

  // Focus trap: intercept Tab/Shift+Tab at the panel edges.
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)

      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !panel.contains(active)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border bg-background shadow-lg outline-none',
          SIZE_CLASSES[size],
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-0.5 text-xs text-muted-foreground"
              >
                {description}
              </p>
            ) : null}
          </div>
          {showCloseButton ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}
