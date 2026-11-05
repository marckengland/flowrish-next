import { afterEach, expect, it, vi } from 'vitest'
import { makeBulkApprovalPlan, previewBulkApproval, runBulkApproval, verifyBulkApproval } from './follow-up-bulk-approval'
const context = { organizationId: 'org', userId: 'actor' }, version = 'a'.repeat(64)
const entry = (id: string, n = 1) => ({ id, listVersion: version, input: { requestId: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, expectedVersion: version, assigneeId: 'actor', title: `Call ${id}`, description: 'Notes', dueDate: '2026-11-09T00:00:00.000Z' } })
const plan = () => makeBulkApprovalPlan([entry('a'), entry('b', 2)], context)
const reply = (id: string, requestId = entry(id, id === 'a' ? 1 : 2).input.requestId, scope = context) => new Response(JSON.stringify({ data: { id, requestId, state: 'confirmed', task: { id: `task-${id}`, assigneeId: 'actor', title: `Call ${id}`, description: 'Notes', dueDate: '2026-11-09T00:00:00.000Z' } }, scope, capabilities: { canWrite: true } }))
afterEach(() => vi.unstubAllGlobals())
it('bounds unique reviewed selections and refuses a different assignee before requesting', () => {
 for (const entries of [[], [entry('a'), entry('a')], Array.from({ length: 21 }, (_, i) => entry(String(i), i + 1)), [{ ...entry('a'), input: { ...entry('a').input, assigneeId: 'other' } }]]) expect(() => makeBulkApprovalPlan(entries, context)).toThrow()
})
it('previews selected rows with scoped GET only and verifies the exact preview identity', async () => {
 const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'a', version, sourceType: 'EMAIL', assigneeId: 'actor', title: 'Call a', description: 'Notes', existingTask: null, leadName: 'Practice' }, scope: context, capabilities: { canWrite: true } }))); vi.stubGlobal('fetch', fetcher)
 expect((await previewBulkApproval(['a'], context, { active: () => true })).map(row => row.id)).toEqual(['a']); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe('GET'); expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'actor']) })
})
it('confirms sequential frozen task fields and accepts only exact task/request receipts', async () => {
 let active = 0, max = 0; const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => { active++; max = Math.max(max, active); const id = String(url).includes('/a/') ? 'a' : 'b'; expect(JSON.parse(String(init?.body))).toEqual(entry(id, id === 'a' ? 1 : 2).input); await Promise.resolve(); active--; return reply(id) }); vi.stubGlobal('fetch', fetcher); const changed: string[] = []
 expect((await runBulkApproval(plan(), context, { active: () => true, onChanged: receipt => changed.push(receipt.id) })).map(row => row.state)).toEqual(['approved', 'approved']); expect(changed).toEqual(['a', 'b']); expect(max).toBe(1); expect(fetcher.mock.calls.every(call => call[1]?.method === 'POST')).toBe(true)
})
it('stops at a lost receipt and verifies the exact request with GET without repeating approval', async () => {
 const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost')); vi.stubGlobal('fetch', fetcher); const result = await runBulkApproval(plan(), context, { active: () => true, onChanged: () => {} }); expect(result.map(row => row.state)).toEqual(['unconfirmed', 'not-attempted']); expect(fetcher).toHaveBeenCalledOnce(); fetcher.mockResolvedValueOnce(reply('a'))
 expect((await verifyBulkApproval(plan(), result, context, { active: () => true, onChanged: () => {} })).map(row => row.state)).toEqual(['verified', 'not-attempted']); expect(fetcher.mock.calls[1][1]?.method).toBe('GET'); expect(String(fetcher.mock.calls[1][0])).toBe('/api/follow-ups/a/approval?requestId=00000001-1111-4111-8111-111111111111'); expect(fetcher).toHaveBeenCalledTimes(2)
})
it('stops for stale scope, wrong request/task receipts, permission denial and changed selections', async () => {
 for (const response of [reply('wrong'), reply('a', entry('b', 2).input.requestId), reply('a', entry('a').input.requestId, { ...context, userId: 'other' }), new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access changed' } }), { status: 403 })]) { const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response); vi.stubGlobal('fetch', fetcher); const rows = await runBulkApproval(plan(), context, { active: () => true, onChanged: () => {} }); expect(rows[0].state).not.toBe('approved'); expect(rows[1].state).toBe('not-attempted'); expect(fetcher).toHaveBeenCalledOnce() }
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await runBulkApproval(plan(), context, { active: () => true, isCurrent: () => false, onChanged: () => {} }); expect(fetcher).not.toHaveBeenCalled()
})
