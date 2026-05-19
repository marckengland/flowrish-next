import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { Shell } from '@/components/layout/shell'
import { getSession } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import type { Permission } from '@/types/permissions'

/**
 * Authenticated layout for all routes under the `(dashboard)` route group.
 *
 * On every request:
 * 1. Resolves the session via `getSession` (Supabase cookie + app User lookup)
 * 2. Redirects to `/login` if the session is missing or invalid
 * 3. Computes the effective permission set as the union of all team role
 *    permissions for the current organization (Requirement 3.7, 3.9)
 * 4. Fetches the active organization name for display in the shell chrome
 * 5. Renders the `Shell` with the user summary and permission set so the
 *    sidebar can filter navigation items before they reach the client
 *
 * The middleware already redirects unauthenticated users for protected
 * routes; this check is a defense-in-depth fallback and also narrows the
 * session type for downstream Server Components.
 *
 * Validates: Requirements 1.5, 1.7, 3.7, 26.4, 26.5
 */
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}): Promise<React.JSX.Element> {
  const session = await getSession()
  if (!session) {
    // Could be unauthenticated OR authenticated but no org membership.
    // Check if the user is authenticated but just hasn't onboarded yet.
    const { createSupabaseServer } = await import('@/lib/supabase/server')
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      // Authenticated but no org → send to onboarding
      redirect('/onboarding')
    }

    redirect('/login')
  }

  // Union of permissions across all team memberships within the active org.
  const permissionSet = new Set<Permission>()
  for (const membership of session.dbUser.teamMemberships) {
    if (membership.team.organizationId !== session.organizationId) continue
    for (const perm of membership.role.permissions) {
      permissionSet.add(perm.key as Permission)
    }
  }

  const organization = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true },
  })

  return (
    <Shell
      user={{
        name: session.dbUser.name,
        email: session.dbUser.email,
        avatarUrl: session.dbUser.avatarUrl,
      }}
      permissions={Array.from(permissionSet)}
      organizationName={organization?.name}
    >
      {children}
    </Shell>
  )
}
