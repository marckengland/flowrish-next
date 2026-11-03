import { inngest } from './client'
import { reconcileCallbackResponsePage } from '@/server/services/callback-response-reconciliation'
export const callbackResponseFunction = inngest.createFunction(
  { id: 'callback-response-targets', concurrency: 1, retries: 3, triggers: [{ cron: '*/5 * * * *' }] },
  async ({ step }) => {
    let after: string | null = '', page = 0, organizations = 0, targets = 0, notifications = 0
    do {
      const cursor: string = after
      const result = await step.run(`response-page-${page++}`, () => reconcileCallbackResponsePage(cursor))
      after = result.after; organizations += result.organizations; targets += result.targets; notifications += result.notifications
    } while (after)
    return { organizations, targets, notifications }
  },
)
