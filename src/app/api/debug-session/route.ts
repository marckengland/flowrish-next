import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'

/**
 * Temporary debug endpoint to inspect session state.
 * DELETE THIS BEFORE PRODUCTION.
 */
export async function GET() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'No supabase user' })
  }

  const dbUser = await prisma.user.findUnique({
    where: { authId: user.id },
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

  if (!dbUser) {
    return NextResponse.json({ error: 'No db user', authId: user.id })
  }

  const defaultMembership = dbUser.organizationMemberships.find(m => m.isDefault)
  const orgId = defaultMembership?.organizationId ?? dbUser.organizationMemberships[0]?.organizationId

  return NextResponse.json({
    userId: dbUser.id,
    orgId,
    orgMembershipsCount: dbUser.organizationMemberships.length,
    teamMembershipsCount: dbUser.teamMemberships.length,
    teamMemberships: dbUser.teamMemberships.map(tm => ({
      teamId: tm.teamId,
      teamOrgId: tm.team.organizationId,
      roleName: tm.role.name,
      permissionCount: tm.role.permissions.length,
      permissions: tm.role.permissions.map(p => p.key),
    })),
  })
}
