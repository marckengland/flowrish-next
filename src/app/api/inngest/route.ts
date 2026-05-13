import { serve } from 'inngest/next'
import { inngest } from '@/server/inngest/client'
import { cadenceStepFunction } from '@/server/inngest/cadence-step'
import { emailSyncFunction } from '@/server/inngest/email-sync'
import { scoreDecayFunction } from '@/server/inngest/score-decay'
import { taskReminderFunction } from '@/server/inngest/task-reminder'
import { forecastSnapshotFunction } from '@/server/inngest/forecast-snapshot'

/**
 * Inngest serve endpoint for flowrish-next.
 *
 * This route handler registers all durable and scheduled functions with
 * Inngest Cloud. Inngest invokes functions via POST, introspects via GET,
 * and registers new functions via PUT.
 *
 * Registered functions:
 * - cadence-step-execution: durable cadence step execution (event-driven)
 * - email-sync: on-demand Gmail inbox sync (event-driven)
 * - score-decay: daily lead score decay (scheduled)
 * - task-reminder: hourly task reminder check (scheduled)
 * - forecast-snapshot: daily pipeline forecast snapshot (scheduled)
 *
 * Retry policy (3 retries with exponential backoff) is configured on each
 * function individually via `inngest.createFunction({ retries: 3, ... })`.
 * Inngest applies exponential backoff by default for retried executions.
 *
 * The signing key authenticates requests from Inngest Cloud.
 *
 * Validates: Requirements 14.6, 14.7
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    cadenceStepFunction,
    emailSyncFunction,
    scoreDecayFunction,
    taskReminderFunction,
    forecastSnapshotFunction,
  ],
})
