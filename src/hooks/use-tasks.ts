'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { taskQueryRoot } from '@/lib/task-query-root'

/**
 * TanStack Query hooks for task data.
 *
 * Tasks are scoped to the active organization (tenant isolation) and to
 * the current user when the user has MEMBER-level access — Requirement
 * 18.5. The server enforces RBAC and organization scoping; this module
 * is only responsible for the client-side fetch plumbing and cache
 * invalidation after mutations.
 *
 * Validates: Requirements 18.1, 18.4, 18.5, 26.3
 */

/**
 * Task shape returned by `GET /api/tasks`.
 *
 * `dueDate`, `completedAt`, `createdAt`, and `updatedAt` are ISO-encoded
 * strings (Next's JSON serializer converts `Date` values). `isOverdue`
 * is computed server-side at query time so the list renders consistent
 * highlighting without requiring every consumer to know the comparison
 * rule (Requirement 18.4 — no grace period).
 */
export interface TaskItem {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  dueDate: string
  isComplete: boolean
  completedAt: string | null
  leadId: string
  assigneeId: string
  organizationId: string
  createdAt: string
  updatedAt: string
  isOverdue: boolean
  lead?: {
    id: string
    firstName: string
    lastName: string
  } | null
  assignee?: {
    id: string
    name: string
    email: string
  } | null
}

export interface TaskListFilters {
  leadId?: string
  isComplete?: boolean
  priority?: 'LOW' | 'MEDIUM' | 'HIGH'
  assigneeId?: string
}

export const tasksKeys = {
  all: taskQueryRoot,
  list: (filters: TaskListFilters) =>
    [...tasksKeys.all, 'list', filters] as const,
}

/**
 * Builds the querystring for `GET /api/tasks`. Undefined filter values are
 * omitted so the resulting URL (and TanStack Query key) stays stable.
 */
export function buildTasksQueryString(filters: TaskListFilters): string {
  const params = new URLSearchParams()
  if (filters.leadId) params.set('leadId', filters.leadId)
  if (filters.isComplete !== undefined)
    params.set('isComplete', String(filters.isComplete))
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function fetchTasks(filters: TaskListFilters): Promise<TaskItem[]> {
  const qs = buildTasksQueryString(filters)
  const res = await fetch(`/api/tasks${qs}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let message = `Failed to load tasks (${res.status})`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body.error?.message) message = body.error.message
    } catch {
      // ignore JSON parse failures — keep the default message
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { data: TaskItem[] }
  return body.data
}

/**
 * Fetches tasks with optional filters, sorted server-side by `dueDate`
 * ascending so overdue items surface at the top of the list.
 *
 * Pass `initialData` from the Server Component render so the list paints
 * immediately and only refetches when the query key invalidates after a
 * mutation (complete, reassign, create).
 */
export function useTasksQuery(
  filters: TaskListFilters,
  initialData?: TaskItem[],
) {
  return useQuery({
    queryKey: tasksKeys.list(filters),
    queryFn: () => fetchTasks(filters),
    initialData,
  })
}

/**
 * Marks a task complete via `PATCH /api/tasks/[id]` with `{ isComplete: true }`
 * and invalidates the task list cache so the UI reflects the change.
 *
 * Validates: Requirements 18.3
 */
export function useCompleteTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<TaskItem> => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ isComplete: true }),
      })
      if (!res.ok) {
        let message = `Failed to complete task (${res.status})`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body.error?.message) message = body.error.message
        } catch {
          // ignore
        }
        throw new Error(message)
      }
      const body = (await res.json()) as { data: TaskItem }
      return body.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tasksKeys.all })
    },
  })
}
