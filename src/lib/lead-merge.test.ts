import { expect, it } from 'vitest'
import { mergePreviewInput, mergeApplyInput } from './lead-merge'
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222'
it('accepts distinct versioned-review identities and rejects self-merges and client-owned scope', () => {
  expect(mergePreviewInput.parse({ id, primaryId: id, secondaryId: other })).toEqual({ id, primaryId: id, secondaryId: other })
  for (const bad of [{ id, primaryId: id, secondaryId: id }, { id, primaryId: id, secondaryId: other, userId: id }, { id: 'bad', primaryId: id, secondaryId: other }]) expect(mergePreviewInput.safeParse(bad).success).toBe(false)
})
it('requires explicit confirmation and only the stored review ID for apply', () => {
  expect(mergeApplyInput.safeParse({ id, confirmed: true }).success).toBe(true)
  for (const bad of [{ id }, { id, confirmed: false }, { id, confirmed: true, secondaryId: other }]) expect(mergeApplyInput.safeParse(bad).success).toBe(false)
})
