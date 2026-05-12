import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { Providers } from './providers'

/**
 * Probe component that captures the QueryClient from context into a mutable
 * holder so the test can assert it is available inside the provider tree.
 */
function ClientProbe({
  capture,
}: {
  capture: (client: QueryClient) => void
}): React.JSX.Element {
  const client = useQueryClient()
  capture(client)
  return <span data-testid="probe">has-client</span>
}

function mount(ui: React.JSX.Element): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

describe('Providers', () => {
  it('renders children', () => {
    const { container, unmount } = mount(
      <Providers>
        <span data-testid="child">hello</span>
      </Providers>,
    )

    const child = container.querySelector('[data-testid="child"]')
    expect(child?.textContent).toBe('hello')
    unmount()
  })

  it('supplies a QueryClient to descendants', () => {
    let captured: QueryClient | null = null
    const { unmount } = mount(
      <Providers>
        <ClientProbe
          capture={(c) => {
            captured = c
          }}
        />
      </Providers>,
    )

    expect(captured).not.toBeNull()
    // Confirm it behaves like a QueryClient (exposes the standard API).
    expect(typeof captured!.getQueryCache).toBe('function')
    unmount()
  })
})
