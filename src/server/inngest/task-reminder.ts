import { inngest } from './client'
import { prisma } from '@/server/db/client'

/**
 * Inngest scheduled function for task reminders.
 *
 * Runs hourly to find all incomplete tasks due within the next 24 hours
 * across all organizations. This is a lightweight stats function — the
 * actual flagging/notification is handled by the UI reading task data
 * with the isOverdue computed field on the rhythm dashboard.
 *
 * Validates: Requirements 14.4
 */
export const taskReminderFunction = inngest.createFunction(
  {
    id: 'task-reminder',
    retries: 3,
  },
  { cron: '0 * * * *' },
  async ({ step }) => {
    // Find all incomplete tasks due within the next 24 hours
    const upcomingTasks = await step.run('find-upcoming-tasks', async () => {
      const now = new Date()
      const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const tasks = await prisma.task.findMany({
        where: {
          isComplete: false,
          dueDate: {
            gte: now,
            lte: in24Hours,
          },
        },
        select: {
          id: true,
          organizationId: true,
        },
      })

      return tasks
    })

    return {
      upcomingTaskCount: upcomingTasks.length,
      checkedAt: new Date().toISOString(),
    }
  },
)
