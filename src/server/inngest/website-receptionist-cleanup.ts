import { inngest } from './client'
import { cleanupWebsiteReceptionist } from '@/server/services/website-receptionist'
import { cleanupVisitorFeedback } from '@/server/services/visitor-feedback-retention'

export const websiteReceptionistCleanupFunction = inngest.createFunction(
  { id: 'website-receptionist-cleanup', retries: 3, concurrency: 1, triggers: [{ cron: '15 3 * * *' }] },
  async ({ step }) => { const cleaned = await step.run('remove-expired-website-sessions', cleanupWebsiteReceptionist); const feedback = await step.run('remove-expired-visitor-feedback', cleanupVisitorFeedback); return { ...cleaned, feedback } },
)
