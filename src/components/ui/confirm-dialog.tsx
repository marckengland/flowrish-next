'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

export interface ConfirmDialogProps {
  open: boolean
  /** Called when the dialog should close (cancel, Escape, backdrop). */
  onClose: () => void
  /** Runs when the user confirms. May be async; the confirm button shows a
   * pending state until it settles, then the dialog closes on success. */
  onConfirm: () => void | Promise<void>
  title: React.ReactNode
  description?: React.ReactNode
  /** Extra body content rendered under the description. */
  children?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` styles the confirm button destructively (for deletes etc.). */
  tone?: 'default' | 'danger'
  /** Reflect external pending state (e.g. a mutation's isPending). */
  loading?: boolean
}

/**
 * Accessible confirmation dialog. Replaces native `window.confirm()` calls
 * with the app's own focus-trapped, theme-aware `Dialog`. The confirm button
 * carries the pending state (both an external `loading` prop and any promise
 * returned by `onConfirm`), and the dialog can only be dismissed via its own
 * controls while a confirm is in flight.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
}: ConfirmDialogProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const pending = busy || loading

  async function handleConfirm(): Promise<void> {
    try {
      setBusy(true)
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={pending ? () => {} : onClose}
      title={title}
      description={description}
      size="sm"
      closeOnBackdrop={!pending}
      showCloseButton={false}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
