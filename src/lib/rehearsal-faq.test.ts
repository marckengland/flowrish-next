import { describe, expect, it } from 'vitest'
import { faqDraftResultSchema, faqOriginSchema, faqDraftInputSchema } from './rehearsal-faq'
const id = '11111111-1111-4111-8111-111111111111'
describe('rehearsal FAQ contracts', () => {
  it('accepts fixed internal links paired with the returned identifier', () => {
    expect(faqDraftResultSchema.parse({ documentId: id, knowledgeUrl: `/knowledge?document=${id}`, created: true }).created).toBe(true)
    expect(faqOriginSchema.parse({ rehearsalId: id, title: 'Pricing rehearsal', messageIndex: 1, rehearsalUrl: `/settings?section=receptionist&rehearsal=${id}` }).messageIndex).toBe(1)
  })
  it('rejects external, mismatched, and script links', () => {
    for (const url of ['https://example.invalid', 'javascript:alert(1)', '/knowledge?document=other', '//example.invalid']) expect(faqDraftResultSchema.safeParse({ documentId: id, knowledgeUrl: url, created: true }).success).toBe(false)
    expect(faqOriginSchema.safeParse({ rehearsalId: id, title: 'Test', messageIndex: 1, rehearsalUrl: '/settings?section=receptionist&rehearsal=other' }).success).toBe(false)
  })
  it('rejects client tenant/content fields, invalid versions, and out-of-range question indices', () => {
    const input = { messageIndex: 1, expectedUpdatedAt: '2026-11-02T00:00:00.000Z' }
    expect(faqDraftInputSchema.parse(input)).toEqual(input)
    for (const extra of [{ organizationId: 'other' }, { question: 'forged' }, { messageIndex: 29 }, { expectedUpdatedAt: 'invalid' }]) expect(faqDraftInputSchema.safeParse({ ...input, ...extra }).success).toBe(false)
  })
})
