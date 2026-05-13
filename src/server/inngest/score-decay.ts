import { inngest } from './client'
import { prisma } from '@/server/db/client'
import { createTenantPrisma } from '@/server/db/middleware'
import { clampScore, recordScoreChange } from '@/server/services/scoring'

/**
 * Inngest scheduled function for daily lead score decay.
 *
 * Runs daily at midnight UTC. For each organization with an active
 * ScoreDecayConfig, finds leads that have been inactive beyond the
 * configured threshold (inactivityDays) and reduces their score by
 * the configured pointReduction amount, clamped to [0, 100].
 *
 * Idempotency: Leads with score already at 0 are skipped. Running
 * twice in the same day produces the same result because:
 * - First run reduces scores and updates lastActivityAt is NOT changed
 * - Second run finds the same leads (lastActivityAt unchanged) but
 *   their scores are already reduced — if score is 0, they're skipped;
 *   if score > 0, the same reduction applies again which is fine since
 *   the function uses a date-based check (today's midnight) to determine
 *   the decay window, ensuring consistent behavior within the same day.
 *
 * Actually, true idempotency is achieved by checking if a decay ScoreHistory
 * entry already exists for the lead on the current day. If it does, skip.
 *
 * Validates: Requirements 14.3, 16.1
 */
export const scoreDecayFunction = inngest.createFunction(
  {
    id: 'score-decay',
    retries: 3,
    triggers: [{ cron: '0 0 * * *' }],
  },
  async ({ step }) => {
    // Step 1: Fetch all organizations with active ScoreDecayConfig
    const configs = await step.run('fetch-active-configs', async () => {
      const activeConfigs = await prisma.scoreDecayConfig.findMany({
        where: { isActive: true },
        select: {
          id: true,
          inactivityDays: true,
          pointReduction: true,
          organizationId: true,
        },
      })

      return activeConfigs
    })

    if (configs.length === 0) {
      return { processed: 0, decayed: 0, skipped: 0 }
    }

    // Step 2: Process each organization's decay
    let totalDecayed = 0
    let totalSkipped = 0

    for (const config of configs) {
      const result = await step.run(
        `decay-org-${config.organizationId}`,
        async () => {
          const db = createTenantPrisma(config.organizationId)

          // Calculate the inactivity threshold date
          const now = new Date()
          const thresholdDate = new Date(
            now.getTime() - config.inactivityDays * 24 * 60 * 60 * 1000,
          )

          // Today's start (midnight UTC) for idempotency check
          const todayStart = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
          )

          // Find leads inactive beyond threshold with score > 0 and not deleted
          const inactiveLeads = await db.lead.findMany({
            where: {
              deletedAt: null,
              score: { gt: 0 },
              OR: [
                { lastActivityAt: { lt: thresholdDate } },
                { lastActivityAt: null },
              ],
            },
            select: {
              id: true,
              score: true,
            },
          })

          let decayed = 0
          let skipped = 0

          for (const lead of inactiveLeads) {
            // Idempotency check: skip if decay already applied today
            const existingDecay = await db.scoreHistory.findFirst({
              where: {
                leadId: lead.id,
                reason: 'decay',
                createdAt: { gte: todayStart },
              },
            })

            if (existingDecay) {
              skipped++
              continue
            }

            // Calculate new score with decay, clamped to [0, 100]
            const previousScore = lead.score
            const newScore = clampScore(previousScore - config.pointReduction)

            // Update lead score
            await db.lead.update({
              where: { id: lead.id },
              data: { score: newScore },
            })

            // Record score change in history
            await recordScoreChange(
              lead.id,
              previousScore,
              newScore,
              'decay',
              config.organizationId,
            )

            decayed++
          }

          return { decayed, skipped }
        },
      )

      totalDecayed += result.decayed
      totalSkipped += result.skipped
    }

    return {
      processed: configs.length,
      decayed: totalDecayed,
      skipped: totalSkipped,
    }
  },
)
