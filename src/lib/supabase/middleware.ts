import { createServerClient, type CookieMethodsServer } from '@supabase/ssr'
import { type NextRequest, type NextResponse } from 'next/server'

/**
 * Creates a Supabase client for use in Next.js middleware.
 * Reads cookies from the request and writes updated cookies to both
 * the request (for downstream handlers) and the response (for the browser).
 *
 * Uses process.env directly since middleware runs at the edge and
 * importing env.ts would halt if any non-public env var is missing.
 *
 * When the Supabase env vars are missing (e.g. local dev without
 * credentials configured), this returns `null` so the caller can
 * decide what to do — typically falling through to the public-route
 * handling so the app still serves /login and the auth pages without
 * crashing the entire middleware pipeline.
 *
 * Validates: Requirement 1.6
 */
export function createSupabaseMiddleware(
  request: NextRequest,
  response: NextResponse,
): ReturnType<typeof createServerClient> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    return null
  }

  const cookies: CookieMethodsServer = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet) => {
      cookiesToSet.forEach(({ name, value, options }) => {
        request.cookies.set(name, value)
        response.cookies.set(name, value, options)
      })
    },
  }

  return createServerClient(url, key, { cookies })
}
