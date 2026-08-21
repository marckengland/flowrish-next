import { useToastStore, type ToastVariant } from '@/stores/toast'

interface ToastOptions {
  description?: string
  /** Override the auto-dismiss delay in ms. */
  duration?: number
}

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  default: 4000,
  success: 3500,
  error: 6000,
}

function push(
  variant: ToastVariant,
  title: string,
  options?: ToastOptions,
): string {
  return useToastStore.getState().add({
    variant,
    title,
    description: options?.description,
    duration: options?.duration ?? DEFAULT_DURATION[variant],
  })
}

/**
 * Ergonomic toast API usable from anywhere (event handlers, mutation
 * callbacks, plain modules) without a hook. Backed by the Zustand toast
 * store singleton and rendered by `<Toaster />`.
 *
 * @example
 *   toast.success('Company deleted')
 *   toast.error('Couldn\'t save changes', { description: err.message })
 */
export const toast = Object.assign(
  (title: string, options?: ToastOptions) => push('default', title, options),
  {
    success: (title: string, options?: ToastOptions) =>
      push('success', title, options),
    error: (title: string, options?: ToastOptions) =>
      push('error', title, options),
    dismiss: (id: string) => useToastStore.getState().dismiss(id),
  },
)
