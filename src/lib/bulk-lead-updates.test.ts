import { expect, it } from 'vitest'
import { bulkLeadApplyInput, bulkLeadPreviewInput, bulkLeadResult, bulkLeadChange } from './bulk-lead-updates'
const id = '11111111-1111-4111-8111-111111111111', time = '2026-11-05T00:00:00.000Z'
it('accepts one bounded owner/status operation and unique versioned leads only', () => {
  expect(bulkLeadPreviewInput.parse({ id, leads: [{ id, expectedUpdatedAt: time }], change: { field: 'leadStatus', value: 'QUALIFIED' } }).change).toEqual({ field: 'leadStatus', value: 'QUALIFIED' })
  for (const change of [{ field: 'stageId', value: id }, { field: 'assignedUserId', value: null }, { field: 'leadStatus', value: 'CLOSED_WON' }, { field: 'leadStatus', value: 'NEW', userId: id }]) expect(bulkLeadChange.safeParse(change).success).toBe(false)
  for (const leads of [[], [{ id, expectedUpdatedAt: 'bad' }], [{ id, expectedUpdatedAt: time }, { id, expectedUpdatedAt: time }], Array.from({ length: 101 }, () => ({ id, expectedUpdatedAt: time }))]) expect(bulkLeadPreviewInput.safeParse({ id, leads, change: { field: 'leadStatus', value: 'NEW' } }).success).toBe(false)
  expect(bulkLeadPreviewInput.safeParse({ id, leads: [{ id, expectedUpdatedAt: time }], change: { field: 'leadStatus', value: 'NEW' }, organizationId: id }).success).toBe(false)
})
it('requires explicit apply acknowledgement and accepts only receipt counts after applying', () => {
  expect(bulkLeadApplyInput.safeParse({ id, confirmed: false }).success).toBe(false)
  expect(bulkLeadApplyInput.safeParse({ id, confirmed: true, change: {} }).success).toBe(false)
  expect(bulkLeadResult.parse({ state: 'applied', id, updated: 1, unchanged: 0, appliedAt: time })).not.toHaveProperty('leads')
})
