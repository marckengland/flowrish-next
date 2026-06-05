import { inngest } from './client'
import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import {
  completeEnrollment,
  computeNextAllowedRunTime,
} from '@/server/services/cadences'

/**
 * Event payload for cadence step execution.
 */
export interface CadenceStepEventData {
  enrollmentId: string
  stepId: string
  cadenceId: string
  leadId: string
  organizationId: string
}

/**
 * Inngest durable function for executing cadence steps.
 *
 * This function handles the full lifecycle of a single cadence step:
 * 1. Verify enrollment is still ACTIVE (no-op if not)
 * 2. Execute the step action (EMAIL, CALL, LINKEDIN, MANUAL_TASK)
 * 3. Create a StepExecutionLog entry with outcome
 * 4. Advance enrollment (increment currentStepOrder)
 * 5. Check if there's a next step — schedule it with delay, or complete enrollment
 *
 * Validates: Requirements 6.7, 6.8, 14.1, 14.6
 */
export const cadenceStepFunction = inngest.createFunction(
  {
    id: 'cadence-step-execution',
    retries: 3,
    triggers: [{ event: 'cadence/step.execute' }],
  },
  async ({ event, step }) => {
    const { enrollmentId, stepId, cadenceId, leadId, organizationId } =
      event.data as CadenceStepEventData

    const db = createTenantPrisma(organizationId)

    // Step 1: Verify enrollment is still ACTIVE (no-op if not)
    const enrollment = await step.run('verify-enrollment', async () => {
      const found = await db.cadenceEnrollment.findFirst({
        where: { id: enrollmentId },
        select: { id: true, status: true, currentStepOrder: true },
      })
      return found
    })

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      return { skipped: true, reason: 'enrollment_not_active' }
    }

    // Step 1.5: Honor the cadence sending window. If the cadence has a
    // schedule and we're currently outside its allowed days/hours, sleep
    // until the next allowed slot before doing any work. We check this
    // before executing the action so reps don't get an email or task
    // appearing at 2am even when their org configured a 9–5 window.
    const scheduleSleep = await step.run('compute-schedule-sleep', async () => {
      const schedule = await db.cadenceSchedule.findUnique({
        where: { cadenceId },
        select: {
          daysOfWeek: true,
          startTimeMinutes: true,
          endTimeMinutes: true,
          timezone: true,
        },
      })
      if (!schedule) return null
      const now = new Date()
      const next = computeNextAllowedRunTime(schedule, now)
      // Only sleep if we'd push the run forward by at least a minute —
      // tiny clock differences shouldn't cause spurious sleeps.
      if (next.getTime() - now.getTime() <= 60 * 1000) return null
      return next.toISOString()
    })

    if (scheduleSleep) {
      await step.sleepUntil('wait-for-schedule-window', scheduleSleep)
    }

    // Step 2: Execute the step action
    const stepRecord = await step.run('execute-action', async () => {
      const cadenceStep = await db.cadenceStep.findFirst({
        where: { id: stepId },
        select: {
          id: true,
          actionType: true,
          emailSubject: true,
          emailBody: true,
          taskTitle: true,
          taskDescription: true,
        },
      })

      if (!cadenceStep) {
        throw new Error(`CadenceStep ${stepId} not found`)
      }

      // Execute action based on type — creates activities and tasks on the lead
      switch (cadenceStep.actionType) {
        case 'EMAIL': {
          // Get enrollment details including threadId for email threading
          const enrollmentForEmail = await db.cadenceEnrollment.findFirst({
            where: { id: enrollmentId },
            select: { enrolledById: true, emailThreadId: true },
          })

          // Create an EMAIL activity on the lead with the cadence step's subject/body.
          // If this is a follow-up email (threadId exists), it will be sent as a reply.
          const emailSubject = enrollmentForEmail?.emailThreadId
            ? `Re: ${cadenceStep.emailSubject ?? 'Follow up'}`
            : (cadenceStep.emailSubject ?? 'Email step')

          await db.activity.create({
            data: tenantData({
              type: 'EMAIL',
              leadId,
              createdById: enrollmentForEmail!.enrolledById,
              notes: `[Cadence] ${emailSubject}`,
              description: cadenceStep.emailBody ?? null,
            }),
          })

          // If this is the first EMAIL step, store a placeholder threadId
          // (In production with Gmail API integration, the actual threadId from
          // Gmail's response would be stored here after sending)
          if (!enrollmentForEmail?.emailThreadId) {
            await db.cadenceEnrollment.update({
              where: { id: enrollmentId },
              data: { emailThreadId: `thread-${enrollmentId}-${Date.now()}` },
            })
          }

          // Update lead's lastActivityAt
          await db.lead.update({
            where: { id: leadId },
            data: { lastActivityAt: new Date() },
          })
          break
        }
        case 'CALL': {
          // Create a task for the rep to make a call
          const enrollment = await db.cadenceEnrollment.findFirst({
            where: { id: enrollmentId },
            select: { enrolledById: true },
          })
          await db.task.create({
            data: tenantData({
              title: cadenceStep.taskTitle ?? 'Make a call (cadence step)',
              description: cadenceStep.taskDescription ?? null,
              priority: 'HIGH',
              dueDate: new Date(), // Due immediately
              leadId,
              assigneeId: enrollment!.enrolledById,
            }),
          })
          break
        }
        case 'LINKEDIN': {
          // Create a task for the rep to do LinkedIn outreach
          const enrollment = await db.cadenceEnrollment.findFirst({
            where: { id: enrollmentId },
            select: { enrolledById: true },
          })
          await db.task.create({
            data: tenantData({
              title: cadenceStep.taskTitle ?? 'LinkedIn outreach (cadence step)',
              description: cadenceStep.taskDescription ?? null,
              priority: 'MEDIUM',
              dueDate: new Date(),
              leadId,
              assigneeId: enrollment!.enrolledById,
            }),
          })
          break
        }
        case 'MANUAL_TASK': {
          // Create a manual task for the rep
          const enrollment = await db.cadenceEnrollment.findFirst({
            where: { id: enrollmentId },
            select: { enrolledById: true },
          })
          await db.task.create({
            data: tenantData({
              title: cadenceStep.taskTitle ?? 'Manual task (cadence step)',
              description: cadenceStep.taskDescription ?? null,
              priority: 'MEDIUM',
              dueDate: new Date(),
              leadId,
              assigneeId: enrollment!.enrolledById,
            }),
          })
          break
        }
      }

      return cadenceStep
    })

    // Step 3: Create StepExecutionLog entry with outcome SUCCESS
    await step.run('create-execution-log', async () => {
      await db.stepExecutionLog.create({
        data: tenantData({
          enrollmentId,
          stepId,
          actionType: stepRecord.actionType,
          outcome: 'SUCCESS',
          attemptCount: 1,
        }),
      })
    })

    // Step 4: Advance enrollment (increment currentStepOrder)
    const nextStepOrder = enrollment.currentStepOrder + 1

    await step.run('advance-enrollment', async () => {
      await db.cadenceEnrollment.update({
        where: { id: enrollmentId },
        data: { currentStepOrder: nextStepOrder },
      })
    })

    // Step 5: Check if there's a next step
    const nextStep = await step.run('check-next-step', async () => {
      const found = await db.cadenceStep.findFirst({
        where: { cadenceId, stepOrder: nextStepOrder },
        select: { id: true, delayHours: true },
      })
      return found
    })

    if (nextStep) {
      // Schedule next step with configurable delay
      if (nextStep.delayHours > 0) {
        await step.sleep('wait-for-delay', `${nextStep.delayHours}h`)
      }

      // Send event to trigger next step execution
      await step.run('schedule-next-step', async () => {
        await inngest.send({
          name: 'cadence/step.execute',
          data: {
            enrollmentId,
            stepId: nextStep.id,
            cadenceId,
            leadId,
            organizationId,
          },
        })
      })

      return { executed: true, nextStepScheduled: true, nextStepId: nextStep.id }
    } else {
      // Final step — complete enrollment
      await step.run('complete-enrollment', async () => {
        await completeEnrollment(enrollmentId, organizationId)
      })

      return { executed: true, completed: true }
    }
  },
)
