import { describe, expect, it } from 'vitest'
import { savedFollowUpViewCreateSchema, savedFollowUpViewUpdateSchema, savedFollowUpSettingsSchema } from './saved-follow-up-views'
const id = '11111111-1111-4111-8111-111111111111'
describe('saved follow-up view contract', () => {
  it('normalizes names and filters, and supports each inbox tab', () => {
    for (const status of ['PENDING', 'APPROVED', 'DISMISSED', 'SNOOZED']) {
      const result = savedFollowUpViewCreateSchema.parse({ id, name: '  My   callbacks  ', settings: { status, filters: { search: ' clinic ', source: 'CALL' } } })
      expect(result.name).toBe('My callbacks'); expect(result.settings).toEqual({ status, filters: { search: 'clinic', source: 'CALL', dueOnly: false } })
    }
  })
  it('rejects extra state, invalid tabs, non-pending due-only views and oversized names/searches', () => {
    const settings = { status: 'PENDING', filters: {} }
    for (const raw of [{ ...settings, draftBody: 'private' }, { ...settings, status: 'ALL' }, { status: 'SNOOZED', filters: { dueOnly: true } }, { ...settings, filters: { search: 'x'.repeat(201) } }]) expect(savedFollowUpSettingsSchema.safeParse(raw).success).toBe(false)
    for (const name of ['', 'x'.repeat(81), 'bad\nname']) expect(savedFollowUpViewCreateSchema.safeParse({ id, name, settings }).success).toBe(false)
    expect(savedFollowUpViewCreateSchema.safeParse({ id, name: 'View', settings, userId: 'other' }).success).toBe(false)
  })
  it('requires a positive revision and at least one explicit update', () => {
    for (const raw of [{ expectedRevision: 1 }, { expectedRevision: 0, name: 'X' }, { expectedRevision: 1, organizationId: 'other' }]) expect(savedFollowUpViewUpdateSchema.safeParse(raw).success).toBe(false)
    expect(savedFollowUpViewUpdateSchema.safeParse({ expectedRevision: 1, settings: { status: 'PENDING', filters: { dueOnly: true } } }).success).toBe(true)
  })
})
