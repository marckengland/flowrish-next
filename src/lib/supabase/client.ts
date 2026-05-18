import { createBrowserClient } from '@supabase/ssr'

/**
 * Creates a Supabase client for use in client (browser) components.
 * Uses process.env directly since these are NEXT_PUBLIC_ vars available
 * at build time, and importing env.ts would halt if server-only vars are missing.
 *
 * Validates: Requirement 1.6
 */
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
