'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Creates a QueryClient with defaults tuned for a Next.js App Router app:
 * - Higher staleTime to reduce refetching triggered by SSR hydration
 * - Disable `refetchOnWindowFocus` in favor of explicit invalidation
 *
 * Zustand stores do not require a provider — they are module-level singletons
 * imported directly from `@/stores/*`. This wrapper only installs TanStack
 * Query, which owns the server-state cache for client components.
 *
 * Validates: Requirements 26.3, 26.4
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}

export interface ProvidersProps {
  children: ReactNode
}

/**
 * Root client-side providers for the app.
 *
 * The QueryClient is instantiated via `useState` so a fresh client is created
 * per component mount — never at module scope — which keeps the cache bound
 * to the component lifecycle and safe across React Server Component renders.
 */
export function Providers({ children }: ProvidersProps): React.JSX.Element {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
