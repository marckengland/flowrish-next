import { expect, it } from 'vitest'
import { approvalInput, approvalPreview, approvalReceipt } from './follow-up-approval'
const input = { requestId: '11111111-1111-4111-8111-111111111111', expectedVersion: 'a'.repeat(64), assigneeId: 'actor', title: '  Call clinic  ', description: 'Notes', dueDate: '2026-11-08T09:00:00+08:00' }
it('normalizes the reviewed title and absolute due time without accepting workflow or mail fields', () => {
 expect(approvalInput.parse(input)).toMatchObject({ title: 'Call clinic', dueDate: '2026-11-08T01:00:00.000Z' })
 for (const extra of [{ status: 'APPROVED' }, { organizationId: 'other' }, { sendEmail: true }]) expect(approvalInput.safeParse({ ...input, ...extra }).success).toBe(false)
 for (const change of [{ title: '' }, { title: 'x'.repeat(201) }, { dueDate: 'invalid' }, { expectedVersion: 'bad' }, { requestId: 'bad' }, { description: 'x'.repeat(10001) }]) expect(approvalInput.safeParse({ ...input, ...change }).success).toBe(false)
})
it('rejects malformed snapshots and ambiguous successful receipts before the batch advances', () => {
 expect(approvalPreview.safeParse({ id: 'item', version: 'bad' }).success).toBe(false)
 expect(approvalReceipt.safeParse({ id: 'item', requestId: input.requestId, state: 'confirmed', task: null }).success).toBe(false)
 expect(approvalReceipt.safeParse({ id: 'item', requestId: input.requestId, state: 'not-recorded', task: null }).success).toBe(true)
})
