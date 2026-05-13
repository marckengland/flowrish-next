import { createTenantPrisma } from '@/server/db/middleware'
import { prisma } from '@/server/db/client'
import { taskCreateSchema } from '@/lib/validators/tasks'
import { AppError } from '@/lib/errors'

/**
 * Filter parameters for task listing.
 */
export interface TaskFilters {
  leadId?: string
  isComplete?: boolean
  priority?: 'LOW' | 'MEDIUM' | 'HIGH'
  assigneeId?: string
}

/**
 * A task with a computed `isOverdue` field.
 */
export interface TaskWithOverdue {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  dueDate: Date
  isComplete: boolean
  completedAt: Date | null
  leadId: string
  assigneeId: string
  organizationId: string
  createdAt: Date
  updatedAt: Date
  isOverdue: boolean
  [key: string]: unknown
}

/**
 * Creates a new task within an organization.
 *
 * - Validates input with Zod (requires title, dueDate, leadId, assigneeId)
 * - Verifies the lead exists within the organization
 * - Verifies the assignee exists
 * - Persists with auto-injected organizationId via tenant middleware
 *
 * Validates: Requirements 18.1, 18.2
 */
export async function createTask(
  data: unknown,
  userId: string,
  orgId: string,
) {
  // Validate input
  const validated = taskCreateSchema.parse(data)

  const db = createTenantPrisma(orgId)

  // Verify the lead exists within the organization
  const lead = await db.lead.findFirst({
    where: { id: validated.leadId, deletedAt: null },
  })

  if (!lead) {
    throw new AppError('LEAD_NOT_FOUND', 'The specified lead does not exist', 404)
  }

  // Verify the assignee exists (User is not tenant-scoped, use global prisma)
  const assignee = await prisma.user.findUnique({
    where: { id: validated.assigneeId },
  })

  if (!assignee) {
    throw new AppError('ASSIGNEE_NOT_FOUND', 'The specified assignee does not exist', 404)
  }

  // Create the task
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  const task = await db.task.create({
    data: {
      title: validated.title,
      description: validated.description ?? null,
      priority: validated.priority,
      dueDate: validated.dueDate,
      leadId: validated.leadId,
      assigneeId: validated.assigneeId,
    } as any,
  })

  return task
}

/**
 * Marks a task as complete.
 *
 * - Sets isComplete=true and completedAt=now()
 * - Creates an Activity of type NOTE on the associated lead with notes "Task completed: {title}"
 *
 * Validates: Requirements 18.3
 */
export async function completeTask(
  id: string,
  userId: string,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  // Find the task
  const task = await db.task.findFirst({
    where: { id },
  })

  if (!task) {
    throw new AppError('TASK_NOT_FOUND', 'Task not found', 404)
  }

  // If already complete, return as-is (idempotent)
  if (task.isComplete) {
    return task
  }

  const now = new Date()

  // Mark task as complete
  const updatedTask = await db.task.update({
    where: { id },
    data: {
      isComplete: true,
      completedAt: now,
    },
  })

  // Log an Activity of type NOTE on the lead
  // Note: organizationId is auto-injected by the tenant middleware at runtime
  await db.activity.create({
    data: {
      type: 'NOTE',
      leadId: task.leadId,
      createdById: userId,
      notes: `Task completed: ${task.title}`,
    } as any,
  })

  // Update the lead's lastActivityAt
  await db.lead.update({
    where: { id: task.leadId },
    data: { lastActivityAt: now },
  })

  return updatedTask
}

/**
 * Reassigns a task to a new assignee.
 *
 * - Validates the new assignee exists
 * - Updates the task's assigneeId
 *
 * Validates: Requirements 18.6
 */
export async function reassignTask(
  id: string,
  newAssigneeId: string,
  orgId: string,
) {
  const db = createTenantPrisma(orgId)

  // Verify the task exists
  const task = await db.task.findFirst({
    where: { id },
  })

  if (!task) {
    throw new AppError('TASK_NOT_FOUND', 'Task not found', 404)
  }

  // Verify the new assignee exists (User is not tenant-scoped, use global prisma)
  const assignee = await prisma.user.findUnique({
    where: { id: newAssigneeId },
  })

  if (!assignee) {
    throw new AppError('ASSIGNEE_NOT_FOUND', 'The specified assignee does not exist', 404)
  }

  // Update the task's assignee
  const updatedTask = await db.task.update({
    where: { id },
    data: { assigneeId: newAssigneeId },
  })

  return updatedTask
}

/**
 * Retrieves tasks for a user with filters, sorted by dueDate ascending.
 *
 * - Returns tasks with a computed `isOverdue` field (dueDate < now and !isComplete)
 * - Sorted by dueDate ascending to surface urgent tasks first
 *
 * Validates: Requirements 18.4, 18.5
 */
export async function getTasks(
  userId: string,
  filters: TaskFilters,
  orgId: string,
): Promise<TaskWithOverdue[]> {
  const db = createTenantPrisma(orgId)

  // Build where clause
  const where: Record<string, unknown> = {}

  if (filters.leadId) {
    where.leadId = filters.leadId
  }

  if (filters.isComplete !== undefined) {
    where.isComplete = filters.isComplete
  }

  if (filters.priority) {
    where.priority = filters.priority
  }

  if (filters.assigneeId) {
    where.assigneeId = filters.assigneeId
  }

  const tasks = await db.task.findMany({
    where,
    orderBy: { dueDate: 'asc' },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true } },
      assignee: { select: { id: true, name: true, email: true } },
    },
  })

  const now = new Date()

  // Add computed isOverdue field
  return tasks.map((task) => ({
    ...task,
    isOverdue: !task.isComplete && task.dueDate < now,
  })) as TaskWithOverdue[]
}
