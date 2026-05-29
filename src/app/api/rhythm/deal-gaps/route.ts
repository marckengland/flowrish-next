import { NextResponse } from 'next/server'

import { requireSession } from '@/server/auth/session'
import { requirePermission } from '@/server/auth/permissions'
import { createTenantPrisma } from '@/server/db/middleware'
import { getLeadAccessFilter } from '@/server/services/access'
import {
  calculateDealEngagementScore,
  classifyDealHealth,
  identifyDealGaps,
  type DealGap,
} from '@/server/services/rhythm'
import { errorResponse } from '@/lib/errors'

/**
 * GET /api/rhythm/deal-gaps — Buckets of open deals that have stalled
 * or single-thread risk.
 *
 * Buckets:
 *   - `noActivitySevenDays` — leads with no activity in the last 7 days.
 *   - `noFutureMeeting` — leads with no upcoming meeting scheduled.
 *   - `singleThreaded` — leads with at most one linked contact and no
 *     future meeting + recent activity combo.
 *
 * Each bucket entry includes enough context (engagement score, deal
 * value, days since last activity) for the dashboard to render rich
 * deal rows without a follow-up fetch.
 *
 * Validates: Requirement 9.6
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
        lastActivityAt: true,
        stage: { select: { name: true } },
      },
      take: 200,
    })

    const now = new Date()
    const enriched = await Promise.all(
      leads.map(async (lead) => {
        const [score, gaps] = await Promise.all([
          calculateDealEngagementScore(lead.id, session.organizationId),
          identifyDealGaps(lead.id, session.organizationId),
        ])
        return {
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`.trim(),
          companyName: lead.companyName,
          stage: lead.stage.name,
          dealValue: lead.dealValue === null ? null : Number(lead.dealValue),
          score,
          riskLevel: classifyDealHealth(score)
            .toLowerCase()
            .replace(' ', '_') as 'healthy' | 'at_risk' | 'critical',
          lastActivityDaysAgo: lead.lastActivityAt
            ? Math.floor(
                (now.getTime() - lead.lastActivityAt.getTime())
                  / (1000 * 60 * 60 * 24),
              )
            : null,
          gaps,
        }
      }),
    )

    function bucketBy(gap: DealGap) {
      return enriched
        .filter((d) => d.gaps.includes(gap))
        // Sort by lowest score so the riskiest deals appear first.
        .sort((a, b) => a.score - b.score)
    }

    return NextResponse.json({
      data: {
        noActivitySevenDays: bucketBy('no_recent_activity'),
        noFutureMeeting: bucketBy('no_future_meeting'),
        singleThreaded: bucketBy('single_threaded'),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
