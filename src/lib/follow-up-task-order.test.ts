import { expect, it } from 'vitest'
import { compareTaskDeadline, taskOrderFromRequest, FOLLOW_UP_TASK_ORDER_HEADER } from './follow-up-task-order'
import { followUpFilterSchema, followUpFiltersFromQuery, followUpListQuery } from './follow-up-filters'
import { filtersForFollowUpTab } from './follow-up-task-progress'
import { savedFollowUpSettingsSchema } from './saved-follow-up-views'
const row = (id: string, dueDate: string | null, createdAt = '2026-11-06T00:00:00.000Z') => ({ id, createdAt, taskProgress: dueDate ? { state: 'OPEN', dueDate } : { state: 'UNAVAILABLE' } })
it('orders authorized deadlines before unavailable dates with deterministic creation/id ties', () => {
 const rows = [row('z', null), row('c', '2099-01-01T00:00:00Z'), row('b', '2020-01-01T00:00:00Z'), row('a', '2020-01-01T00:00:00Z'), row('d', '2020-01-01T00:00:00Z', '2026-11-07T00:00:00Z')]
 expect(rows.sort(compareTaskDeadline).map(row => row.id)).toEqual(['d', 'a', 'b', 'c', 'z'])
})
it('keeps default contracts unchanged and round-trips only the explicit earliest order', () => {
 expect(followUpFilterSchema.parse({})).toEqual({ search: '', source: 'ALL', dueOnly: false })
 const filters = followUpFiltersFromQuery(new URLSearchParams('taskOrder=DUE_ASC&source=CALL'))!
 expect(filters).toEqual({ search: '', source: 'CALL', dueOnly: false, taskOrder: 'DUE_ASC' }); expect(followUpListQuery('APPROVED', filters).toString()).toBe('status=APPROVED&source=CALL&taskOrder=DUE_ASC')
 for (const value of ['taskOrder=wrong', 'taskOrder=DUE_ASC&taskOrder=DUE_ASC']) expect(() => followUpFiltersFromQuery(new URLSearchParams(value))).toThrow()
 expect(() => followUpFilterSchema.parse({ dueOnly: true, taskOrder: 'DUE_ASC' })).toThrow()
})
it('binds saved order to Approved and clears it when changing tabs while retaining other filters', () => {
 const filters = followUpFilterSchema.parse({ source: 'CALL', taskOrder: 'DUE_ASC' })
 expect(savedFollowUpSettingsSchema.parse({ status: 'APPROVED', filters }).filters.taskOrder).toBe('DUE_ASC')
 expect(() => savedFollowUpSettingsSchema.parse({ status: 'PENDING', filters })).toThrow()
 expect(filtersForFollowUpTab(filters, 'PENDING')).toEqual({ search: '', source: 'CALL', dueOnly: false }); expect(filtersForFollowUpTab(filters, 'APPROVED')).toEqual(filters)
})
it('requires explicit header opt-in without assuming older servers support ordering', () => {
 expect(taskOrderFromRequest(new Request('https://example.invalid'))).toBe(false)
 expect(taskOrderFromRequest(new Request('https://example.invalid', { headers: { [FOLLOW_UP_TASK_ORDER_HEADER]: '1' } }))).toBe(true)
 expect(() => taskOrderFromRequest(new Request('https://example.invalid', { headers: { [FOLLOW_UP_TASK_ORDER_HEADER]: 'yes' } }))).toThrow()
})
