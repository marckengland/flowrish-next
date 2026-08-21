import { create } from 'zustand'

/**
 * Toast notification state.
 *
 * A tiny, dependency-free notification system to give users feedback after
 * mutations (save / delete / import succeeded or failed). Kept as a
 * module-level Zustand singleton — matching the pattern of the other stores
 * in this folder — so any client component (or a plain module function) can
 * push a toast without threading a provider through the tree.
 *
 * The visual rendering lives in `@/components/ui/toaster`; the ergonomic
 * `toast.success(...)` / `toast.error(...)` helpers are exported from
 * `@/lib/toast`.
 */

export type ToastVariant = 'default' | 'success' | 'error'

export interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  /** Auto-dismiss delay in ms. Errors linger longer than successes. */
  duration: number
}

export interface ToastState {
  toasts: readonly Toast[]
  add: (toast: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
  clear: () => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (toast) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    return id
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))
