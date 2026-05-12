import { beforeEach, describe, expect, it } from 'vitest'

import { useLayoutStore } from './layout'

/**
 * Unit tests for the Zustand layout store.
 *
 * Validates: Requirements 26.4, 26.5
 */
describe('useLayoutStore', () => {
  beforeEach(() => {
    // Reset to defaults between tests — Zustand stores persist across tests.
    useLayoutStore.setState({ sidebarCollapsed: false, chatOpen: false })
  })

  it('defaults sidebarCollapsed to false and chatOpen to false', () => {
    const state = useLayoutStore.getState()
    expect(state.sidebarCollapsed).toBe(false)
    expect(state.chatOpen).toBe(false)
  })

  it('setSidebarCollapsed updates the flag', () => {
    useLayoutStore.getState().setSidebarCollapsed(true)
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true)

    useLayoutStore.getState().setSidebarCollapsed(false)
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false)
  })

  it('toggleSidebar flips the flag each call', () => {
    const { toggleSidebar } = useLayoutStore.getState()
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false)

    toggleSidebar()
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true)

    toggleSidebar()
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false)
  })

  it('setChatOpen updates the flag', () => {
    useLayoutStore.getState().setChatOpen(true)
    expect(useLayoutStore.getState().chatOpen).toBe(true)

    useLayoutStore.getState().setChatOpen(false)
    expect(useLayoutStore.getState().chatOpen).toBe(false)
  })

  it('toggleChat flips chatOpen each call', () => {
    const { toggleChat } = useLayoutStore.getState()
    expect(useLayoutStore.getState().chatOpen).toBe(false)

    toggleChat()
    expect(useLayoutStore.getState().chatOpen).toBe(true)

    toggleChat()
    expect(useLayoutStore.getState().chatOpen).toBe(false)
  })

  it('sidebar and chat state are independent', () => {
    useLayoutStore.getState().toggleSidebar()
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true)
    expect(useLayoutStore.getState().chatOpen).toBe(false)

    useLayoutStore.getState().toggleChat()
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true)
    expect(useLayoutStore.getState().chatOpen).toBe(true)
  })
})
