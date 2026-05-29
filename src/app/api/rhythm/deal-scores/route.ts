import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { getLeadAccessFilter } from '@/server/services/access'
import {
  calculateDealEngagementScore,
  classifyDealHealth,
} from '@/server/services/rhythm'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/rhythm/deal-scores — Engagement scores for every open lead
 * the caller can see.
 *
 * The Rhythm dashboard groups deals into Healthy / At Risk / Critical
 * buckets based on the engagement score so reps can triage their book
 * at a glance. We compute scores in parallel because each lead requires
 * its own activity / contact / pipeline-shape lookups; a serial loop
 * over even a moderate book of business would be noticeably slow.
 *
 * Validates: Requirements 9.4, 9.5
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
        companyName: true,
        dealValue: true,
        currency: true,
        lastActivityAt: true,
        stage: { select: { name: true } },
        _count: { select: { contacts: true } },
      },
      take: 200,
    })

    const now = new Date()
    const scored = await Promise.all(
      leads.map(async (lead) => {
        const score = await calculateDealEngagementScore(
          lead.id,
          session.organizationId,
        )
        const health = classifyDealHealth(score)
        return {
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`.trim(),
          companyName: lead.companyName,
          stage: lead.stage.name,
          dealValue: lead.dealValue === null ? null : Number(lead.dealValue),
          currency: lead.currency,
          score,
          riskLevel: healthToRiskLevel(health),
          stakeholderCount: lead._count.contacts,
          lastActivityDaysAgo: lead.lastActivityAt
            ? Math.floor(
                (now.getTime() - lead.lastActivityAt.getTime())
                  / (1000 * 60 * 60 * 24),
              )
            : null,
        }
      }),
    )

    // Risky deals first so the most urgent work bubbles to the top.
    scored.sort((a, b) => a.score - b.score)
    return NextResponse.json({ data: scored })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Maps the human-readable health classification to the lower-case
 * tokens the existing UI uses for color coding. Keeps the internal
 * classifier stable while letting the UI consume a tidier vocabulary.
 */
function healthToRiskLevel(
  health: 'Healthy' | 'At Risk' | 'Critical',
): 'healthy' | 'at_risk' | 'critical' {
  switch (health) {
    case 'Healthy':
      return 'healthy'
    case 'At Risk':
      return 'at_risk'
    case 'Critical':
      return 'critical'
  }
}
