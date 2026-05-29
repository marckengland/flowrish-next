import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { getLeadAccessFilter } from '@/server/services/access'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/leads/ranked — Returns leads ordered by score descending.
 *
 * Used by the scoring page's "Leads by Score" panel to surface the
 * highest-priority prospects without making the user sort manually.
 *
 * The same RBAC access filter applied elsewhere is enforced here so
 * MEMBER users see only their own assignments while OWNER/ADMIN see
 * all leads in the org.
 *
 * Closed leads are excluded from the ranking — we want users to focus
 * on open opportunities.
 *
 * Validates: Requirements 4.1, 4.2, 18.1, 18.2
 */
export async function GET() {
  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:read')

    const accessFilter = await getLeadAccessFilter(
      session.dbUser,
      session.organizationId,
    )

    const db = createTenantPrisma(session.organizationId)
    const leads = await db.lead.findMany({
      where: {
        ...accessFilter,
        deletedAt: null,
        isClosed: false,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        score: true,
        dealValue: true,
        currency: true,
        stage: { select: { id: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
      },
      orderBy: [
        { score: 'desc' },
        { dealValue: 'desc' },
        { lastName: 'asc' },
      ],
      take: 100,
    })

    return NextResponse.json({
      data: leads.map((lead) => ({
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        score: lead.score,
        dealValue: lead.dealValue === null ? null : Number(lead.dealValue),
        currency: lead.currency,
        stage: lead.stage,
        assignedUser: lead.assignedUser,
      })),
    })
  } catch (error) {
    return errorResponse(error)
  }
}
