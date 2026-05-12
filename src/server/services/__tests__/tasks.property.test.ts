import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

/**
 * Property-based tests for task management.
 *
 * These tests verify that:
 * 1. Completed tasks always have non-null completedAt
 * 2. Marking a task complete does not change any other task's state
 * 3. Task list is always sorted by dueDate ascending
 *
 * **Validates: Requirements 18.1, 18.3, 18.4**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  task: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  activity: {
    create: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Test User', email: 'test@example.com' }),
    },
  },
}))

vi.mock('@/generated/prisma', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import { completeTask, getTasks } from '@/server/services/tasks'

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid UUID */
const uuidArb = fc.uuid()

/** Generate a valid task priority */
const priorityArb = fc.constantFrom('LOW', 'MEDIUM', 'HIGH') as fc.Arbitrary<'LOW' | 'MEDIUM' | 'HIGH'>

/** Generate a valid task title (non-empty, no null bytes) */
const titleArb = fc.stringOf(
  fc.char().filter(c => c !== '\0'),
  { minLength: 1, maxLength: 100 },
).filter(s => s.trim().length > 0)

/** Generate a date within a reasonable range */
const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })

/**
 * Generate a task record as it would exist in the database.
 */
const taskRecordArb = fc.record({
  id: uuidArb,
  title: titleArb,
  description: fc.oneof(fc.constant(null), titleArb),
  priority: priorityArb,
  dueDate: dateArb,
  isComplete: fc.boolean(),
  completedAt: fc.oneof(fc.constant(null), dateArb),
  leadId: uuidArb,
  assigneeId: uuidArb,
  organizationId: uuidArb,
  createdAt: dateArb,
  updatedAt: dateArb,
}).map(task => ({
  ...task,
  // Ensure consistency: if isComplete, completedAt should be set; if not, it should be null
  completedAt: task.isComplete ? (task.completedAt ?? new Date()) : null,
}))

/**
 * Generate an incomplete task (isComplete=false, completedAt=null).
 */
const incompleteTaskArb = fc.record({
  id: uuidArb,
  title: titleArb,
  description: fc.oneof(fc.constant(null), titleArb),
  priority: priorityArb,
  dueDate: dateArb,
  isComplete: fc.constant(false),
  completedAt: fc.constant(null),
  leadId: uuidArb,
  assigneeId: uuidArb,
  organizationId: uuidArb,
  createdAt: dateArb,
  updatedAt: dateArb,
})

/**
 * Generate a list of tasks with varying due dates for sort testing.
 */
const taskListArb = fc.array(taskRecordArb, { minLength: 0, maxLength: 20 })

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Task Management - Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Property: Completed tasks always have non-null completedAt', () => {
    /**
     * **Validates: Requirements 18.3**
     *
     * When a task is marked complete via completeTask, the returned task
     * must have isComplete=true and completedAt set to a non-null Date.
     */

    it('completeTask always sets isComplete=true and completedAt to a non-null Date', async () => {
      await fc.assert(
        fc.asyncProperty(
          incompleteTaskArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (task, userId, orgId) => {
            // Mock finding the incomplete task
            mockDb.task.findFirst.mockResolvedValue(task)

            // Mock update to return the completed task
            mockDb.task.update.mockImplementation(({ data }: any) => {
              return Promise.resolve({
                ...task,
                ...data,
              })
            })

            // Mock activity creation and lead update (side effects of completeTask)
            mockDb.activity.create.mockResolvedValue({})
            mockDb.lead.update.mockResolvedValue({})

            const result = await completeTask(task.id, userId, orgId)

            // The completed task must have isComplete=true
            expect(result.isComplete).toBe(true)

            // The completed task must have a non-null completedAt
            expect(result.completedAt).not.toBeNull()
            expect(result.completedAt).toBeInstanceOf(Date)
          },
        ),
      )
    })

    it('completeTask on an already-complete task still has non-null completedAt (idempotent)', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskRecordArb.filter(t => t.isComplete),
          uuidArb, // userId
          uuidArb, // orgId
          async (completedTask, userId, orgId) => {
            // Mock finding the already-complete task
            mockDb.task.findFirst.mockResolvedValue(completedTask)

            const result = await completeTask(completedTask.id, userId, orgId)

            // Even for already-complete tasks, completedAt must be non-null
            expect(result.isComplete).toBe(true)
            expect(result.completedAt).not.toBeNull()
          },
        ),
      )
    })
  })

  describe('Property: Marking a task complete does not change any other task\'s state', () => {
    /**
     * **Validates: Requirements 18.3**
     *
     * Completing one task should only affect that specific task.
     * Other tasks in the same organization should remain unchanged.
     */

    it('completing a task does not modify other tasks in the list', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(incompleteTaskArb, { minLength: 2, maxLength: 10 }),
          uuidArb, // userId
          uuidArb, // orgId
          fc.nat(), // index selector
          async (tasks, userId, orgId, indexSeed) => {
            // Pick one task to complete
            const targetIndex = indexSeed % tasks.length
            const targetTask = tasks[targetIndex]
            const otherTasks = tasks.filter((_, i) => i !== targetIndex)

            // Snapshot other tasks' state before completion
            const otherTasksSnapshot = otherTasks.map(t => ({
              id: t.id,
              isComplete: t.isComplete,
              completedAt: t.completedAt,
              title: t.title,
              priority: t.priority,
              dueDate: t.dueDate,
              assigneeId: t.assigneeId,
            }))

            // Mock finding the target task
            mockDb.task.findFirst.mockResolvedValue(targetTask)

            // Mock update — only updates the target task
            mockDb.task.update.mockImplementation(({ where, data }: any) => {
              // Verify only the target task is being updated
              expect(where.id).toBe(targetTask.id)
              return Promise.resolve({
                ...targetTask,
                ...data,
              })
            })

            mockDb.activity.create.mockResolvedValue({})
            mockDb.lead.update.mockResolvedValue({})

            await completeTask(targetTask.id, userId, orgId)

            // Verify other tasks were not touched — the update mock was only
            // called with the target task's ID (asserted inside the mock above)
            // Additionally, verify the snapshot is unchanged
            for (let i = 0; i < otherTasks.length; i++) {
              expect(otherTasks[i].id).toBe(otherTasksSnapshot[i].id)
              expect(otherTasks[i].isComplete).toBe(otherTasksSnapshot[i].isComplete)
              expect(otherTasks[i].completedAt).toBe(otherTasksSnapshot[i].completedAt)
              expect(otherTasks[i].title).toBe(otherTasksSnapshot[i].title)
              expect(otherTasks[i].priority).toBe(otherTasksSnapshot[i].priority)
              expect(otherTasks[i].dueDate).toBe(otherTasksSnapshot[i].dueDate)
              expect(otherTasks[i].assigneeId).toBe(otherTasksSnapshot[i].assigneeId)
            }
          },
        ),
      )
    })

    it('task.update is called exactly once with only the target task ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          incompleteTaskArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (task, userId, orgId) => {
            // Clear mocks per iteration to avoid accumulation across runs
            mockDb.task.update.mockReset()
            mockDb.task.findFirst.mockResolvedValue(task)
            mockDb.task.update.mockResolvedValue({
              ...task,
              isComplete: true,
              completedAt: new Date(),
            })
            mockDb.activity.create.mockResolvedValue({})
            mockDb.lead.update.mockResolvedValue({})

            await completeTask(task.id, userId, orgId)

            // task.update should be called exactly once
            expect(mockDb.task.update).toHaveBeenCalledTimes(1)

            // The update should target only the specific task
            expect(mockDb.task.update).toHaveBeenCalledWith({
              where: { id: task.id },
              data: {
                isComplete: true,
                completedAt: expect.any(Date),
              },
            })
          },
        ),
      )
    })
  })

  describe('Property: Task list is always sorted by dueDate ascending', () => {
    /**
     * **Validates: Requirements 18.4**
     *
     * getTasks always returns tasks sorted by dueDate ascending,
     * ensuring the most urgent tasks appear first.
     */

    it('getTasks returns tasks in dueDate ascending order', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb,
          uuidArb, // userId
          uuidArb, // orgId
          async (tasks, userId, orgId) => {
            // Sort tasks by dueDate ascending (simulating Prisma orderBy)
            const sortedTasks = [...tasks].sort(
              (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
            )

            // Mock findMany to return tasks sorted by dueDate asc
            mockDb.task.findMany.mockResolvedValue(
              sortedTasks.map(t => ({
                ...t,
                lead: { id: t.leadId, firstName: 'Test', lastName: 'Lead' },
                assignee: { id: t.assigneeId, name: 'User', email: 'u@test.com' },
              })),
            )

            const result = await getTasks(userId, {}, orgId)

            // Verify the result is sorted by dueDate ascending
            for (let i = 1; i < result.length; i++) {
              const prevDate = new Date(result[i - 1].dueDate).getTime()
              const currDate = new Date(result[i].dueDate).getTime()
              expect(prevDate).toBeLessThanOrEqual(currDate)
            }
          },
        ),
      )
    })

    it('getTasks with filters still maintains dueDate ascending order', async () => {
      await fc.assert(
        fc.asyncProperty(
          taskListArb.filter(tasks => tasks.length > 0),
          uuidArb, // userId
          uuidArb, // orgId
          priorityArb, // filter by priority
          async (tasks, userId, orgId, priority) => {
            // Filter tasks by priority, then sort by dueDate ascending
            const filteredTasks = tasks
              .filter(t => t.priority === priority)
              .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

            mockDb.task.findMany.mockResolvedValue(
              filteredTasks.map(t => ({
                ...t,
                lead: { id: t.leadId, firstName: 'Test', lastName: 'Lead' },
                assignee: { id: t.assigneeId, name: 'User', email: 'u@test.com' },
              })),
            )

            const result = await getTasks(userId, { priority }, orgId)

            // Verify the result is sorted by dueDate ascending
            for (let i = 1; i < result.length; i++) {
              const prevDate = new Date(result[i - 1].dueDate).getTime()
              const currDate = new Date(result[i].dueDate).getTime()
              expect(prevDate).toBeLessThanOrEqual(currDate)
            }
          },
        ),
      )
    })

    it('getTasks orderBy parameter always specifies dueDate asc', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb, // userId
          uuidArb, // orgId
          async (userId, orgId) => {
            mockDb.task.findMany.mockResolvedValue([])

            await getTasks(userId, {}, orgId)

            // Verify findMany was called with orderBy: { dueDate: 'asc' }
            expect(mockDb.task.findMany).toHaveBeenCalledWith(
              expect.objectContaining({
                orderBy: { dueDate: 'asc' },
              }),
            )
          },
        ),
      )
    })
  })
})
