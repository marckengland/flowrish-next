import { inngest } from './client'
import { runCallbackNotificationSweep } from '@/server/services/callback-notifications'
export const callbackNotificationFunction = inngest.createFunction(
  { id: 'callback-notifications', retries: 3, concurrency: 1, triggers: [{ cron: '*/5 * * * *' }] },
  async ({ step }) => step.run('reconcile-callback-notifications', runCallbackNotificationSweep),
)
