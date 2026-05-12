import { inngest } from './client'
import { createTenantPrisma } from '@/server/db/middleware'
import { completeEnrollment } from '@/server/services/cadences'

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
  },
  { event: 'cadence/step.execute' },
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

      // Execute action based on type.
      // For now, log the action — actual email/call execution is in later tasks.
      switch (cadenceStep.actionType) {
        case 'EMAIL':
          // Future: send email via Gmail API with personalization
          break
        case 'CALL':
          // Future: create call task for rep
          break
        case 'LINKEDIN':
          // Future: create LinkedIn outreach task
          break
        case 'MANUAL_TASK':
          // Future: create manual task for rep
          break
      }

      return cadenceStep
    })

    // Step 3: Create StepExecutionLog entry with outcome SUCCESS
    await step.run('create-execution-log', async () => {
      await db.stepExecutionLog.create({
        data: {
          enrollmentId,
          stepId,
          actionType: stepRecord.actionType,
          outcome: 'SUCCESS',
          attemptCount: 1,
        } as any,
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
