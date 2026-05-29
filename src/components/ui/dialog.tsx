'use client'

import { useEffect, useRef } from 'react'
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
}

const SIZE_CLASSES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/**
 * Modal dialog primitive. Replaces the ad-hoc `fixed inset-0 z-50` markup
 * scattered through the codebase with one accessible, dismissable surface
 * that handles:
 *   - Escape-to-close
 *   - backdrop click-to-close (opt-out via `closeOnBackdrop`)
 *   - focus trap-light: focuses the first focusable element when opened
 *   - aria-modal + aria-labelledby for screen readers
 *
 * Body scroll is locked while the dialog is open so the page underneath
 * doesn't scroll behind the backdrop.
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
}: DialogProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Escape-to-close + body scroll lock.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose])

  // Focus the first focusable element after open.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const first = panel.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cn(
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border bg-background shadow-lg',
          SIZE_CLASSES[size],
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-3">
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
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
