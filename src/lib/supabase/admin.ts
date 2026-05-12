import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/**
 * Creates a Supabase client with the service role key for privileged
 * server-side operations that bypass RLS (e.g. Storage uploads, signed
 * URL generation for files a user has access to via app-level RBAC).
 *
 * IMPORTANT: Never expose this client to the browser. It must only be used
 * in server-only code paths (Server Actions, Route Handlers, services).
 *
 * Application-level access control (tenant isolation, RBAC) must be
 * enforced by the caller before invoking operations with this client.
 */
let cachedClient: SupabaseClient | null = null

export function createSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient

  cachedClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )

  return cachedClient
}
