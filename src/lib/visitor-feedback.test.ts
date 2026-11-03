import { describe, expect, it } from 'vitest'
import { feedbackInputSchema, feedbackPolicyInputSchema, feedbackQuerySchema, feedbackListSchema } from './visitor-feedback'
const requestId = '11111111-1111-4111-8111-111111111111'
describe('opt-in visitor feedback contract', () => {
  it('requires explicit consent, a completed request identifier, bounded reviewed text and no extra data', () => {
    expect(feedbackInputSchema.parse({ requestId, question: '  Can you repair a bicycle?  ', consented: true, website: '' }).question).toBe('Can you repair a bicycle?')
    for (const change of [{ consented: false }, { requestId: 'forged' }, { question: '' }, { question: '\0' }, { question: 'x'.repeat(1001) }, { question: '語'.repeat(700) }, { transcript: 'private' }, { website: 'bot' }]) expect(feedbackInputSchema.safeParse({ requestId, question: 'Repairs?', consented: true, website: '', ...change }).success).toBe(false)
  })
  it('requires acknowledged opt-in and current versions, and rejects arbitrary list scope', () => {
    const input = { enabled: true, acknowledged: false, expectedUpdatedAt: '2026-11-03T00:00:00.000Z' }; expect(feedbackPolicyInputSchema.safeParse(input).success).toBe(false); expect(feedbackPolicyInputSchema.safeParse({ ...input, acknowledged: true }).success).toBe(true); expect(feedbackPolicyInputSchema.safeParse({ ...input, enabled: false }).success).toBe(true)
    expect(feedbackQuerySchema.parse({})).toEqual({ status: 'open', page: 1 }); expect(feedbackQuerySchema.safeParse({ organizationId: 'foreign' }).success).toBe(false)
    expect(feedbackListSchema.safeParse({ rows: [], page: 1, hasMore: false, pageSize: 20, apiKey: 'private' }).success).toBe(false)
  })
})
