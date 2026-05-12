import { createSupabaseServer } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import type { User as SupabaseUser } from '@supabase/supabase-js'

/**
 * Represents the authenticated session returned by getSession/requireSession.
 *
 * - authUser: The Supabase auth user (from auth.users)
 * - dbUser: The application User record with team memberships and role permissions
 * - organizationId: The user's default organization ID (resolved server-side)
 */
export interface Session {
  authUser: SupabaseUser
  dbUser: SessionUser
  organizationId: string
}

/**
 * The application User with team memberships and their associated roles/permissions.
 * Used for RBAC checks throughout the application.
 */
export type SessionUser = NonNullable<Awaited<ReturnType<typeof fetchDbUser>>>

async function fetchDbUser(authId: string) {
  return prisma.user.findUnique({
    where: { authId },
    include: {
      organizationMemberships: true,
      teamMemberships: {
        include: {
          team: true,
          role: {
            include: { permissions: true },
          },
        },
      },
    },
  })
}

/**
 * Validates the current Supabase session and fetches the corresponding
 * application User with team memberships and role permissions.
 *
 * Returns null if:
 * - No valid Supabase session exists (expired, corrupted, or missing cookie)
 * - No matching application User record found for the auth user
 * - No default organization membership found for the user
 *
 * The organizationId is always resolved server-side from the user's default
 * organization membership — never from client input.
 *
 * Validates: Requirements 1.2, 1.5, 1.7
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const dbUser = await fetchDbUser(user.id)
  if (!dbUser) return null

  // Resolve organizationId from the user's default organization membership
  const defaultMembership = dbUser.organizationMemberships.find(
    (m) => m.isDefault
  )

  // If no default membership exists, fall back to the first membership
  const membership = defaultMembership ?? dbUser.organizationMemberships[0]
  if (!membership) return null

  return {
    authUser: user,
    dbUser,
    organizationId: membership.organizationId,
  }
}

/**
 * Requires a valid authenticated session. Throws a 401 AppError if
 * no valid session exists.
 *
 * Use this in Server Actions, Route Handlers, and Server Components
 * that require authentication.
 *
 * Validates: Requirements 1.5, 1.7
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) {
    throw new AppError('UNAUTHORIZED', 'Authentication required', 401)
  }
  return session
}
