import { expect, it } from 'vitest'
import { followUpFilterSchema, followUpFiltersFromQuery, followUpListQuery } from './follow-up-filters'
import { savedFollowUpSettingsSchema } from './saved-follow-up-views'
import { taskProgressSchema } from './follow-up-task-progress'
import { encodeFollowUpCursor, decodeFollowUpCursor } from '@/server/services/follow-up-page-cursor'
it('preserves old defaults and serializes only explicit progress filters', () => {
 expect(followUpFilterSchema.parse({})).toEqual({ search: '', source: 'ALL', dueOnly: false })
 const filters = followUpFiltersFromQuery(new URLSearchParams('source=CALL&taskProgress=OVERDUE'))!
 expect(filters).toEqual({ search: '', source: 'CALL', dueOnly: false, taskProgress: 'OVERDUE' }); expect(followUpListQuery('APPROVED', filters).toString()).toBe('status=APPROVED&source=CALL&taskProgress=OVERDUE')
 for (const query of ['taskProgress=OTHER', 'taskProgress=OPEN&taskProgress=COMPLETED', 'taskProgress=OPEN&dueOnly=1']) expect(() => followUpFiltersFromQuery(new URLSearchParams(query))).toThrow()
})
it('saves Approved progress settings while rejecting incompatible tabs and fake completion dates', () => {
 expect(savedFollowUpSettingsSchema.parse({ status: 'APPROVED', filters: { taskProgress: 'COMPLETED' } }).filters.taskProgress).toBe('COMPLETED')
 expect(savedFollowUpSettingsSchema.safeParse({ status: 'PENDING', filters: { taskProgress: 'OPEN' } }).success).toBe(false)
 expect(taskProgressSchema.safeParse({ state: 'UNAVAILABLE', dueDate: '2026-11-06T00:00:00Z' }).success).toBe(false)
 expect(taskProgressSchema.safeParse({ state: 'COMPLETED', dueDate: '2026-11-06T00:00:00.000Z', completedAt: null, checkedAt: '2026-11-07T00:00:00.000Z' }).success).toBe(true)
})
it('binds page cursors to the progress filter and opt-in mode', () => {
 const scope = { organizationId: 'org', userId: 'actor', status: 'APPROVED', filters: followUpFilterSchema.parse({ taskProgress: 'OPEN' }), taskProgress: true }, anchor = { id: '11111111-1111-4111-8111-111111111111', createdAt: new Date('2026-11-06') }
 const cursor = encodeFollowUpCursor(scope, anchor); expect(decodeFollowUpCursor(scope, cursor)).toEqual({ id: anchor.id, createdAt: anchor.createdAt })
 for (const changed of [{ ...scope, filters: followUpFilterSchema.parse({ taskProgress: 'COMPLETED' }) }, { ...scope, taskProgress: false }]) expect(() => decodeFollowUpCursor(changed, cursor)).toThrow()
})
