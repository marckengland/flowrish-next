'use client'

import { WORKSPACE_HEADER } from './workspace-context'

export function clearWorkspaceBrowserState() {
  try {
    localStorage.removeItem('flowrish:leads:filters')
  } catch {
    /* Storage may be unavailable. */
  }
  try {
    sessionStorage.removeItem('airish:active-conversation')
  } catch {
    /* Storage may be unavailable. */
  }
}

export function workspaceFetch(
  original: typeof fetch,
  origin: string,
  organizationId: string,
  stale: () => void,
  paused: () => boolean,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      origin,
    )
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    const scoped =
      url.origin === origin &&
      (url.pathname.startsWith('/api/') ||
        headers.has('next-action') ||
        headers.has('rsc'))
    if (!scoped) return original(input, init)
    if (paused() && url.pathname !== '/api/workspaces')
      throw new Error('The business is changing. Reload before continuing.')
    headers.set(WORKSPACE_HEADER, organizationId)
    const response = await original(input, { ...init, headers })
    if (
      [403, 409].includes(response.status) &&
      response.headers.get('content-type')?.includes('application/json')
    ) {
      const body = await response
        .clone()
        .json()
        .catch(() => null)
      if (
        [
          'WORKSPACE_CHANGED',
          'WORKSPACE_ACCESS_REVOKED',
          'WORKSPACE_CONTEXT_REQUIRED',
        ].includes(body?.error?.code)
      )
        stale()
    }
    return response
  }
}
