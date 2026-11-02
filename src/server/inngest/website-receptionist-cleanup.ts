import { inngest } from './client'
import { cleanupWebsiteReceptionist } from '@/server/services/website-receptionist'

export const websiteReceptionistCleanupFunction = inngest.createFunction(
  { id: 'website-receptionist-cleanup', retries: 3, concurrency: 1, triggers: [{ cron: '15 3 * * *' }] },
  async ({ step }) => step.run('remove-expired-website-sessions', cleanupWebsiteReceptionist),
)
