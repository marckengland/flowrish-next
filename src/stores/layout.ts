import { create } from 'zustand'

/**
 * Client-side UI state for the dashboard shell.
 *
 * Tracks:
 * - `sidebarCollapsed`: whether the navigation sidebar is in its narrow icon-only mode
 * - `chatOpen`: whether the AI chatbot sidebar is visible
 *
 * This Zustand store replaces the `LayoutContext` Context-based pattern from the
 * source repo (Requirement 26.4: use Zustand for client UI state). It is a module-level
 * singleton — no provider required — so any client component can subscribe directly.
 *
 * Validates: Requirements 26.3, 26.4, 26.5
 */
export interface LayoutState {
  sidebarCollapsed: boolean
  chatOpen: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setChatOpen: (open: boolean) => void
  toggleChat: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarCollapsed: false,
  chatOpen: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setChatOpen: (open) => set({ chatOpen: open }),
  toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
}))
