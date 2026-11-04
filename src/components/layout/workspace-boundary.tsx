'use client'

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  clearWorkspaceBrowserState,
  workspaceFetch,
} from '@/lib/workspace-browser'
import { WORKSPACE_EVENT } from '@/lib/workspace-context'

const WorkspaceSwitchContext = createContext<(organizationId: string) => void>(
  () => {},
)
export function useWorkspaceSwitch() {
  return useContext(WorkspaceSwitchContext)
}

export function WorkspaceBoundary({
  organizationId,
  children,
}: {
  organizationId?: string
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const paused = useRef(false)
  const [switching, setSwitching] = useState(false)
  const channel = useRef<BroadcastChannel | null>(null)

  const clear = useCallback(() => {
    void queryClient.cancelQueries().catch(() => {})
    queryClient.clear()
    clearWorkspaceBrowserState()
  }, [queryClient])
  const recover = useCallback(() => {
    if (paused.current) return
    paused.current = true
    setSwitching(true)
    clear()
    window.location.replace('/workspaces')
  }, [clear])

  useLayoutEffect(() => {
    const original = window.fetch
    const guarded = workspaceFetch(
      original.bind(window),
      window.location.origin,
      organizationId ?? 'default',
      recover,
      () => paused.current,
    )
    window.fetch = guarded
    const storage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_EVENT && event.newValue) recover()
    }
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) recover()
    }
    window.addEventListener('storage', storage)
    window.addEventListener('pageshow', pageshow)
    if (typeof window.BroadcastChannel === 'function') {
      channel.current = new BroadcastChannel(WORKSPACE_EVENT)
      channel.current.onmessage = recover
    }
    return () => {
      if (window.fetch === guarded) window.fetch = original
      window.removeEventListener('storage', storage)
      window.removeEventListener('pageshow', pageshow)
      channel.current?.close()
      channel.current = null
    }
    // A full document navigation replaces this boundary on a workspace change.
  }, [organizationId, recover])

  async function switchTo(target: string) {
    if (paused.current || target === organizationId) return
    paused.current = true
    setSwitching(true)
    clear()
    try {
      const response = await window.fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: target }),
      })
      const body = await response.json()
      if (!response.ok || body?.data?.organizationId !== target)
        throw new Error('Switch not confirmed')
      try {
        localStorage.setItem(WORKSPACE_EVENT, crypto.randomUUID())
      } catch {
        /* The fetch guard also protects other tabs. */
      }
      try {
        channel.current?.postMessage('changed')
      } catch {
        /* The storage event is a second notification path. */
      }
      window.location.replace('/dashboard')
    } catch {
      // The cookie might have changed even if its response was lost. Never retry a write.
      window.location.replace('/workspaces?switch=uncertain')
    }
  }

  return (
    <WorkspaceSwitchContext.Provider value={switchTo}>
      {switching ? (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
          <div role="status" className="space-y-3 text-center">
            <p>Loading your business…</p>
            <a className="underline" href="/workspaces">
              Choose a business
            </a>
          </div>
        </main>
      ) : (
        children
      )}
    </WorkspaceSwitchContext.Provider>
  )
}
