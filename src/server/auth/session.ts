import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  selectedWorkspace,
  WORKSPACE_COOKIE,
  WORKSPACE_HEADER,
  WORKSPACE_METHOD_HEADER,
  WORKSPACE_PATH_HEADER,
} from '@/lib/workspace-context'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import type { User as SupabaseUser } from '@supabase/supabase-js'

/**
 * Represents the authenticated session returned by getSession/requireSession.
 *
 * - authUser: The Supabase auth user (from auth.users)
 * - dbUser: The application User record with team memberships and role permissions
 * - organizationId: The selected retained organization ID (resolved server-side)
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
export async function getWorkspaceIdentity() {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const dbUser = await fetchDbUser(user.id)
  return dbUser ? { authUser: user, dbUser } : null
}

export async function getSession(): Promise<Session | null> {
  const identity = await getWorkspaceIdentity()
  if (!identity) return null
  const { authUser, dbUser } = identity
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ])
  const chosen = selectedWorkspace(
    cookieStore.get(WORKSPACE_COOKIE)?.value,
    authUser.id,
  )
  const fallback =
    dbUser.organizationMemberships.find((m) => m.isDefault) ??
    dbUser.organizationMemberships[0]
  const membership = chosen
    ? dbUser.organizationMemberships.find((m) => m.organizationId === chosen)
    : fallback
  const method = requestHeaders.get(WORKSPACE_METHOD_HEADER) ?? 'GET'
  const path = requestHeaders.get(WORKSPACE_PATH_HEADER)
  if (chosen && !membership) {
    if (method === 'GET' && path && !path.startsWith('/api/'))
      redirect('/workspaces')
    throw new AppError(
      'WORKSPACE_ACCESS_REVOKED',
      'Choose a business you still have access to.',
      403,
    )
  }
  if (!membership) return null
  const expected = requestHeaders.get(WORKSPACE_HEADER)
  if (
    expected &&
    (expected === 'default' ? fallback?.organizationId : expected) !==
      membership.organizationId
  )
    throw new AppError(
      'WORKSPACE_CHANGED',
      'The active business changed. Reload before continuing.',
      409,
    )
  if (chosen && !['GET', 'HEAD'].includes(method) && !expected)
    throw new AppError(
      'WORKSPACE_CONTEXT_REQUIRED',
      'Reload this business before making changes.',
      409,
    )
  return {
    authUser,
    dbUser: {
      ...dbUser,
      teamMemberships: dbUser.teamMemberships.filter(
        (m) => m.team.organizationId === membership.organizationId,
      ),
    },
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
