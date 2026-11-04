'use client'

import { useEffect, useState } from 'react'
import { useWorkspaceSwitch } from './workspace-boundary'

export function WorkspaceSwitcher({
  organizationId,
  organizationName,
  dark = false,
}: {
  organizationId?: string
  organizationName?: string
  dark?: boolean
}) {
  const [workspaces, setWorkspaces] = useState<
    Array<{ id: string; name: string }>
  >([])
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [loading, setLoading] = useState(true)
  const switchTo = useWorkspaceSwitch()
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    void fetch('/api/workspaces', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Business list unavailable')
        const body = await response.json()
        if (!Array.isArray(body?.data?.workspaces))
          throw new Error('Business list unavailable')
        if (!controller.signal.aborted) setWorkspaces(body.data.workspaces)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWorkspaces([])
          setError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [attempt])
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="sr-only" htmlFor="workspace-selector">
        Business
      </label>
      <select
        id="workspace-selector"
        value={organizationId ?? ''}
        disabled={
          loading || error || (Boolean(organizationId) && workspaces.length < 2)
        }
        aria-busy={loading}
        onChange={(event) => switchTo(event.target.value)}
        className={`h-11 w-full min-w-0 rounded-[10px] border px-2 text-sm font-semibold disabled:opacity-70 ${dark ? 'border-white/15 bg-sidebar text-sidebar-foreground' : 'border-border bg-background text-foreground'}`}
      >
        {loading || error ? (
          <option value={organizationId ?? ''}>
            {organizationName ?? 'Choose a business'}
          </option>
        ) : (
          <>
            {!organizationId && (
              <option value="" disabled>
                Choose a business
              </option>
            )}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </>
        )}
      </select>
      {error ? (
        <p className="text-xs">
          Couldn’t load businesses.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry businesses
          </button>
        </p>
      ) : (
        <p
          className={`text-[11px] leading-4 ${dark ? 'text-sidebar-foreground/60' : 'text-muted-foreground'}`}
        >
          {!loading && workspaces.length === 0
            ? 'You don’t belong to a business yet.'
            : 'Switching reloads the app and discards unsaved edits.'}
        </p>
      )}
    </div>
  )
}
