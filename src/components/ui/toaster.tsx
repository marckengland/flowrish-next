'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useToastStore, type Toast } from '@/stores/toast'

/**
 * Global toast viewport. Renders the toast stack into a portal on `document.body`
 * so it floats above every surface (including dialogs).
 *
 * Accessibility: the region is an `aria-live` container. Success/info use
 * `polite`; errors use an `assertive`/`alert` role so they interrupt. Each
 * toast carries a manual dismiss button in addition to auto-dismiss.
 *
 * Mounted once in `Providers`.
 */
export function Toaster(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      // Non-error toasts announce politely; error toasts use their own
      // role="alert" below for assertive delivery.
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({ toast }: { toast: Toast }): React.JSX.Element {
  const dismiss = useToastStore((s) => s.dismiss)

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.duration, dismiss])

  const Icon =
    toast.variant === 'success'
      ? CheckCircle2
      : toast.variant === 'error'
        ? AlertCircle
        : Info

  const accent =
    toast.variant === 'success'
      ? 'text-brand'
      : toast.variant === 'error'
        ? 'text-danger-foreground'
        : 'text-muted-foreground'

  return (
    <div
      role={toast.variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-xl border bg-card p-3.5 shadow-[0_16px_40px_-24px_rgba(0,0,0,0.4)]',
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2',
      )}
    >
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', accent)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}
