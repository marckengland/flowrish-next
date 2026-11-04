import { forecastBasis } from '@/lib/forecast-basis'
import { forecastPeriod } from '@/lib/forecast-period'
import { inngest } from './client'
import { prisma } from '@/server/db/client'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { calculatePipelineMetrics } from '@/server/services/forecast'

/**
 * Inngest scheduled function for daily forecast snapshots.
 *
 * Runs daily at 01:00 UTC. For each organization, calculates pipeline
 * metrics (total pipeline, weighted pipeline, AI predicted) and counts
 * closed won/lost leads in the current month, then creates a
 * ForecastSnapshot record for trend tracking.
 *
 * The snapshot period is stored in YYYY-MM format representing the
 * current month at the time of execution.
 *
 * Validates: Requirements 10.4, 14.5
 */
export const forecastSnapshotFunction = inngest.createFunction(
  {
    id: 'forecast-snapshot',
    retries: 3,
    triggers: [{ cron: '0 1 * * *' }],
  },
  async ({ step }) => {
    // Step 1: Fetch all organizations
    const organizations = await step.run('fetch-organizations', async () => {
      return prisma.organization.findMany({
        select: { id: true },
      })
    })

    if (organizations.length === 0) {
      return { processed: 0, snapshots: 0 }
    }

    // Calculate current period (YYYY-MM)
    const now = new Date()
    const period = forecastPeriod(now)

    // Calculate start of current month for closed lead counts
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    // Step 2: Create snapshot for each organization
    let snapshotsCreated = 0

    for (const org of organizations) {
      const result = await step.run(
        `snapshot-org-${org.id}`,
        async () => {
          const db = createTenantPrisma(org.id)

          // Calculate pipeline metrics
          const metrics = await calculatePipelineMetrics(org.id)

          // Count closed won leads in current month
          const closedWon = await db.lead.count({
            where: {
              isClosed: true,
              deletedAt: null,
              closeDate: { gte: monthStart },
              stage: { isClosedWon: true },
            },
          })

          // Count closed lost leads in current month
          const closedLost = await db.lead.count({
            where: {
              isClosed: true,
              deletedAt: null,
              closeDate: { gte: monthStart },
              stage: { isClosedLost: true },
            },
          })

          // Create ForecastSnapshot record
          // Note: organizationId is auto-injected by the tenant middleware at runtime
          await db.forecastSnapshot.create({
            data: tenantData({
              period,
              ...forecastBasis('ORGANIZATION'),
              totalPipeline: metrics.totalPipeline,
              weightedPipeline: metrics.weightedPipeline,
              aiPredicted: metrics.aiPredicted,
              closedWon,
              closedLost,
            }),
          })

          return { created: true }
        },
      )

      if (result.created) {
        snapshotsCreated++
      }
    }

    return {
      processed: organizations.length,
      snapshots: snapshotsCreated,
      period,
    }
  },
)
