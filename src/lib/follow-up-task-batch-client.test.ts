import { afterEach, expect, it, vi } from 'vitest'
import { saveTaskBatchIntent } from './follow-up-task-batch-client'
import { runBulkTaskCompletion } from './follow-up-bulk-task-completion'
const scope = { organizationId: 'org', userId: 'actor' }, input = { requestId: '11111111-1111-4111-8111-111111111111', expectedVersion: 'a'.repeat(64), taskId: 'task' }
const batch = { id: '22222222-2222-4222-8222-222222222222', kind: 'COMPLETE' as const, items: [{ id: 'source', input }] }
const reply = (data: unknown, wrong = false, write = true) => new Response(JSON.stringify({ data, scope: wrong ? { ...scope, userId: 'other' } : scope, capabilities: { canWrite: write } }))
afterEach(() => vi.restoreAllMocks())
it('saves only metadata and verifies exact registration and scope before task requests', async () => {
 const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => reply({ registration: JSON.parse(String(init?.body)), createdAt: '2026-11-06T00:00:00.000Z' }))
 await saveTaskBatchIntent(batch, scope, { active: () => true })
 expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe('/api/follow-ups/batches'); expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'x-flowrish-workspace': 'org' }, body: JSON.stringify(batch) })
 for (const response of [reply({ registration: { ...batch, id: input.requestId }, createdAt: '2026-11-06T00:00:00.000Z' }), reply({ registration: batch, createdAt: '2026-11-06T00:00:00.000Z' }, true), reply({ registration: batch, createdAt: '2026-11-06T00:00:00.000Z' }, false, false)]) {
  fetcher.mockResolvedValueOnce(response); await expect(saveTaskBatchIntent(batch, scope, { active: () => true })).rejects.toBeDefined()
 }
 expect(fetcher.mock.calls.every(([url]) => url === '/api/follow-ups/batches')).toBe(true)
})
it('uses the optional batch header only on mutations, preserving existing request bodies', async () => {
 const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ id: 'source', requestId: input.requestId, state: 'confirmed', task: { id: 'task', dueDate: '2030-01-01T00:00:00.000Z', completedAt: '2026-11-06T00:00:00.000Z', checkedAt: '2026-11-06T00:00:00.000Z' } }))
 const changed = vi.fn(); await runBulkTaskCompletion([{ ...batch.items[0], listKey: 'key' }], scope, { active: () => true, batchId: batch.id, onChanged: changed })
 expect(fetcher).toHaveBeenCalledWith('/api/follow-ups/source/task-completion', expect.objectContaining({ method: 'POST', body: JSON.stringify(input), headers: expect.objectContaining({ 'x-flowrish-task-batch': batch.id }) })); expect(changed).toHaveBeenCalledTimes(1)
})
it('stops on a lost registration without attempting any task request', async () => {
 const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('lost'))
 await expect(saveTaskBatchIntent(batch, scope, { active: () => true })).rejects.toThrow('No task requests were started')
 expect(fetcher).toHaveBeenCalledTimes(1)
})
