import { createServerClient } from '@supabase/ssr'
import { type NextRequest, type NextResponse } from 'next/server'

/**
 * Creates a Supabase client for use in Next.js middleware.
 * Reads cookies from the request and writes updated cookies to both
 * the request (for downstream handlers) and the response (for the browser).
 *
 * Uses process.env directly since middleware runs at the edge and
 * importing env.ts would halt if any non-public env var is missing.
 *
 * Validates: Requirement 1.6
 */
export function createSupabaseMiddleware(
  request: NextRequest,
  response: NextResponse
) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )
}
