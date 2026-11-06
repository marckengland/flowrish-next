import { describe, it, expect } from 'vitest'
import { taskBatchRegistration, taskBatchDetail, taskBatchList } from './follow-up-task-batches'
const item = { id: 'source', input: { requestId: '11111111-1111-4111-8111-111111111111', taskId: 'task', expectedVersion: 'a'.repeat(64) } }
const batch = { id: '22222222-2222-4222-8222-222222222222', kind: 'COMPLETE', items: [item] }
describe('private task batch contracts', () => {
 it('accepts bounded unique intent without labels or drafts', () => {
  expect(taskBatchRegistration.parse(batch)).toEqual(batch)
  for (const items of [[], Array(21).fill(item), [item, item], [{ ...item, title: 'private' }]]) expect(taskBatchRegistration.safeParse({ ...batch, items }).success).toBe(false)
  expect(taskBatchRegistration.safeParse({ ...batch, email: 'private' }).success).toBe(false)
 })
 it('requires matching deadline conversion and a common target', () => {
  const row = { ...item, input: { ...item.input, localTime: '2030-01-01T10:00', timeZone: 'Asia/Manila' }, previousDueDate: '2029-01-01T00:00:00.000Z', dueDate: '2030-01-01T02:00:00.000Z' }
  expect(taskBatchRegistration.safeParse({ ...batch, kind: 'RESCHEDULE', items: [row] }).success).toBe(true)
  expect(taskBatchRegistration.safeParse({ ...batch, kind: 'RESCHEDULE', items: [{ ...row, dueDate: '2030-01-01T03:00:00.000Z' }] }).success).toBe(false)
 })
 it('redacts unavailable rows and rejects accidental private fields', () => {
  const detail = { id: batch.id, kind: 'COMPLETE', createdAt: '2026-11-06T00:00:00.000Z', checkedAt: '2026-11-06T00:00:00.000Z', items: [{ index: 0, state: 'unavailable' }] }
  expect(taskBatchDetail.parse(detail)).toEqual(detail)
  expect(taskBatchDetail.safeParse({ ...detail, items: [{ index: 0, state: 'unavailable', taskId: 'secret' }] }).success).toBe(false)
  expect(taskBatchList.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null })
 })
})
