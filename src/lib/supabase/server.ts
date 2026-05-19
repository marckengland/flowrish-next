import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * Creates a Supabase client for use in Server Components and Server Actions.
 * Uses the Next.js cookies() API (async in Next.js 15) for session management.
 *
 * The setAll callback is wrapped in try-catch because it may be called from
 * a Server Component where cookies cannot be set (read-only context). This is
 * expected — Supabase refreshes tokens and tries to write updated cookies,
 * but in a Server Component that write is a no-op. The middleware handles
 * cookie refresh for subsequent requests.
 *
 * Validates: Requirement 1.6
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies()

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookies are read-only.
            // The middleware will handle token refresh on the next request.
          }
        },
      },
    }
  )
}
