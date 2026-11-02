import { describe, expect, it } from 'vitest'
import { callbackOutcomeDraftSchema, callbackOutcomeCommitSchema } from './callback-outcomes'
const id = '11111111-1111-4111-8111-111111111111'
const draft = { outcome: 'reached', action: 'record', notes: 'Staff spoke to the visitor.', assigneeId: null, dueDate: null }
describe('callback outcome boundaries', () => {
  it('requires an explicit result and rejects silently ignored scheduling fields', () => {
    expect(callbackOutcomeDraftSchema.safeParse(draft).success).toBe(true)
    expect(callbackOutcomeDraftSchema.safeParse({ ...draft, outcome: 'automatic_call' }).success).toBe(false)
    expect(callbackOutcomeDraftSchema.safeParse({ ...draft, assigneeId: id }).success).toBe(false)
    expect(callbackOutcomeDraftSchema.safeParse({ ...draft, action: 'reschedule' }).success).toBe(false)
    expect(callbackOutcomeDraftSchema.safeParse({ ...draft, action: 'reschedule', assigneeId: id, dueDate: '2030-01-01T00:00:00.000Z' }).success).toBe(true)
    expect(callbackOutcomeDraftSchema.safeParse({ ...draft, notes: 'x'.repeat(2001) }).success).toBe(false)
  })
  it('requires immutable request identity, current version, preview and approval', () => {
    const input = { draft, expectedVersion: 'a'.repeat(64), previewVersion: 'b'.repeat(64), requestId: id, confirmed: true }
    expect(callbackOutcomeCommitSchema.safeParse(input).success).toBe(true)
    expect(callbackOutcomeCommitSchema.safeParse({ ...input, confirmed: false }).success).toBe(false)
    expect(callbackOutcomeCommitSchema.safeParse({ ...input, organizationId: id }).success).toBe(false)
  })
})
