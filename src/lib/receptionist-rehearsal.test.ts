import { describe, expect, it } from 'vitest'
import { rehearsalSnapshotSchema, rehearsalReviewSchema, validateRehearsalReview } from './receptionist-rehearsal'

const snapshot = { clientId: '11111111-1111-4111-8111-111111111111', settingsVersion: '2026-11-02T00:00:00.000Z', finished: false, messages: [
  { role: 'receptionist', content: 'Hello', sources: [], generation: 'scripted' },
  { role: 'caller', content: 'What does a repair cost?', sources: [], generation: 'scripted' },
  { role: 'receptionist', content: 'A repair costs 250 pesos.', sources: [{ id: '22222222-2222-4222-8222-222222222222', title: 'Prices', revision: 2 }], generation: 'ai' },
] }
describe('rehearsal snapshot and human review validation', () => {
  it('accepts bounded transcript snapshots with per-reply source revisions', () => {
    expect(rehearsalSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(validateRehearsalReview({ verdict: 'needs_work', notes: 'Missing detail', unansweredMessageIndexes: [1] }, snapshot.messages)).toEqual({ verdict: 'needs_work', notes: 'Missing detail', unansweredMessageIndexes: [1] })
  })
  it('rejects foreign fields, excessive messages, invalid sources, and caller citations', () => {
    expect(rehearsalSnapshotSchema.safeParse({ ...snapshot, organizationId: 'other' }).success).toBe(false)
    expect(rehearsalSnapshotSchema.safeParse({ ...snapshot, messages: Array(30).fill(snapshot.messages[0]) }).success).toBe(false)
    expect(rehearsalSnapshotSchema.safeParse({ ...snapshot, messages: [{ ...snapshot.messages[1], sources: snapshot.messages[2].sources }] }).success).toBe(false)
    expect(rehearsalSnapshotSchema.safeParse({ ...snapshot, messages: [{ ...snapshot.messages[2], sources: [{ id: 'bad', title: 'Prices', revision: 0 }] }] }).success).toBe(false)
  })
  it('bounds total serialized UTF-8 size and accepts only caller indices as knowledge gaps', () => {
    expect(rehearsalSnapshotSchema.safeParse({ ...snapshot, messages: Array(29).fill({ ...snapshot.messages[0], content: '€'.repeat(4096) }) }).success).toBe(false)
    for (const indexes of [[0], [2], [3], [1, 1]]) expect(() => validateRehearsalReview({ verdict: 'needs_work', notes: '', unansweredMessageIndexes: indexes }, snapshot.messages)).toThrow()
    expect(rehearsalReviewSchema.safeParse({ verdict: 'auto_pass', notes: '', unansweredMessageIndexes: [] }).success).toBe(false)
    expect(rehearsalReviewSchema.safeParse({ verdict: 'passed', notes: 'x'.repeat(2001), unansweredMessageIndexes: [] }).success).toBe(false)
  })
})
