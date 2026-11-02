import { inngest } from './client'
import { scheduleMailboxSyncs } from '@/server/services/mailbox-sync'

/** Queue due connected mailboxes without reading provider data in the cron. */
export const mailboxSyncScheduleFunction = inngest.createFunction(
  { id: 'mailbox-sync-schedule', retries: 3, concurrency: 1, triggers: [{ cron: '*/5 * * * *' }] },
  async ({ step }) => step.run('queue-due-mailboxes', scheduleMailboxSyncs),
)
