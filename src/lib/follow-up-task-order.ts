import { z } from 'zod'

export const FOLLOW_UP_TASK_ORDER_HEADER = 'x-flowrish-task-order'
export const taskOrderSchema = z.literal('DUE_ASC')
export function taskOrderFromRequest(request: Request) {
  const value = request.headers.get(FOLLOW_UP_TASK_ORDER_HEADER)
  if (value === null) return false
  z.literal('1').parse(value)
  return true
}
type OrderedRow = { id: string; createdAt: string | Date; taskProgress?: { state: string; dueDate?: string } }
export function compareTaskDeadline(a: OrderedRow, b: OrderedRow) {
  const deadline = (row: OrderedRow) => row.taskProgress?.state !== 'UNAVAILABLE' && row.taskProgress?.dueDate ? Date.parse(row.taskProgress.dueDate) : Infinity
  const left = deadline(a), right = deadline(b)
  return (left === right ? 0 : left < right ? -1 : 1) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || a.id.localeCompare(b.id)
}
