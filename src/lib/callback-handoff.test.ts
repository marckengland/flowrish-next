import { describe, expect, it } from 'vitest'
import { handoffDraftSchema, handoffCommitSchema } from './callback-handoff'
const id = '11111111-1111-4111-8111-111111111111'
const draft = { expectedUpdatedAt: '2026-11-03T00:00:00.000Z', target: { mode: 'lead', leadId: id }, assigneeId: id, dueDate: '2026-12-01T00:00:00.000Z', acknowledgeDuplicate: false }
describe('callback handoff contracts', () => {
  it('accepts only explicit scoped targets and bounded names', () => {
    expect(handoffDraftSchema.parse(draft)).toEqual(draft)
    expect(handoffDraftSchema.safeParse({ ...draft, organizationId: id }).success).toBe(false)
    expect(handoffDraftSchema.safeParse({ ...draft, target: { mode: 'new', firstName: 'Jamie', lastName: '', stageId: id, contactId: null } }).success).toBe(false)
    expect(handoffDraftSchema.safeParse({ ...draft, target: { mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId: id, contactId: id } }).success).toBe(true)
  })
  it('requires reviewed fingerprint and explicit confirmation', () => {
    expect(handoffCommitSchema.safeParse({ draft, previewVersion: 'a'.repeat(64), confirmed: true }).success).toBe(true)
    expect(handoffCommitSchema.safeParse({ draft, previewVersion: 'a'.repeat(64), confirmed: false }).success).toBe(false)
    expect(handoffCommitSchema.safeParse({ draft, previewVersion: 'bad', confirmed: true }).success).toBe(false)
  })
})
