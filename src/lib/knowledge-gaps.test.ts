import { describe, expect, it } from 'vitest'
import { gapPageSchema, gapReviewInputSchema, gapOccurrenceSchema } from './knowledge-gaps'
const id = '11111111-1111-4111-8111-111111111111'
describe('knowledge gap contracts', () => {
  it('accepts bounded pages and requires explicit retesting to resolve', () => {
    expect(gapPageSchema.parse({})).toEqual({ page: 1 })
    expect(gapPageSchema.parse({ page: '2' })).toEqual({ page: 2 })
    expect(gapReviewInputSchema.safeParse({ expectedVersion: 'a'.repeat(64), action: 'resolve', retested: true, notes: 'Checked the saved rehearsal.' }).success).toBe(true)
    expect(gapReviewInputSchema.safeParse({ expectedVersion: 'a'.repeat(64), action: 'resolve', retested: false, notes: '' }).success).toBe(false)
    for (const page of ['-1', '1.5', '10001', 'bad']) expect(gapPageSchema.safeParse({ page }).success).toBe(false)
  })
  it('rejects client tenant fields and arbitrary links', () => {
    expect(gapReviewInputSchema.safeParse({ expectedVersion: 'a'.repeat(64), action: 'reopen', retested: false, notes: '', organizationId: 'other' }).success).toBe(false)
    const item = { rehearsalId: id, title: 'Sample', messageIndex: 1, updatedAt: '2026-11-03T00:00:00.000Z', rehearsalUrl: `/settings?section=receptionist&rehearsal=${id}`, faq: null }
    expect(gapOccurrenceSchema.safeParse(item).success).toBe(true)
    expect(gapOccurrenceSchema.safeParse({ ...item, rehearsalUrl: 'https://example.invalid' }).success).toBe(false)
  })
})
