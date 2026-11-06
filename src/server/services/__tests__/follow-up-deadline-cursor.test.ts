import { expect, it } from 'vitest'
import { encodeFollowUpCursor, decodeFollowUpCursor } from '../follow-up-page-cursor'
import { followUpFilterSchema } from '@/lib/follow-up-filters'
const scope = { organizationId: 'org', userId: 'actor', status: 'APPROVED', taskProgress: true, filters: followUpFilterSchema.parse({ taskOrder: 'DUE_ASC' }) }
const anchor = { id: '11111111-1111-4111-8111-111111111111', createdAt: new Date('2026-11-06T00:00:00Z'), dueDate: new Date('2020-01-01T00:00:00Z'), orderVersion: 'a'.repeat(64) }
it('round-trips deadline and unavailable anchors without changing default cursor format', () => {
 const raw = encodeFollowUpCursor(scope, anchor); expect(decodeFollowUpCursor(scope, raw)).toEqual(anchor)
 expect(decodeFollowUpCursor(scope, encodeFollowUpCursor(scope, { ...anchor, dueDate: null }))).toEqual({ ...anchor, dueDate: null })
 const legacy = { ...scope, filters: followUpFilterSchema.parse({}) }, old = encodeFollowUpCursor(legacy, anchor)
 expect(JSON.parse(Buffer.from(old, 'base64url').toString()).v).toBe(1); expect(decodeFollowUpCursor(legacy, old)).toEqual({ id: anchor.id, createdAt: anchor.createdAt })
})
it('rejects a cursor from another order, filter, account or workspace', () => {
 const token = encodeFollowUpCursor(scope, anchor)
 for (const value of [{ ...scope, filters: followUpFilterSchema.parse({}) }, { ...scope, filters: followUpFilterSchema.parse({ taskOrder: 'DUE_ASC', source: 'CALL' }) }, { ...scope, userId: 'other' }, { ...scope, organizationId: 'other' }]) expect(() => decodeFollowUpCursor(value, token)).toThrow()
})
