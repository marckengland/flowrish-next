import { afterEach, expect, it, vi } from 'vitest'
import { readFollowUpPages } from './follow-up-pages'
const context = { organizationId: 'org', userId: 'actor' }, filters = { search: '', source: 'ALL' as const, dueOnly: false, taskProgress: 'OVERDUE' as const }
const row = { id: 'item', createdAt: '2026-11-06T00:00:00.000Z', status: 'APPROVED', taskProgress: { state: 'OVERDUE', dueDate: '2026-11-05T00:00:00.000Z', completedAt: null, checkedAt: '2026-11-06T00:00:00.000Z' } }
const response = (progress = true, data: unknown = row) => new Response(JSON.stringify({ data: [data], scope: context, capabilities: { canWrite: false, ...(progress ? { taskProgress: true } : {}) } }))
const input = () => ({ status: 'APPROVED', filters, context, retained: [], depth: 1, signal: new AbortController().signal })
afterEach(() => vi.unstubAllGlobals())
it('sends explicit progress opt-in and preserves validated server metadata without writes', async () => {
 const request = vi.fn<typeof fetch>().mockResolvedValue(response()); vi.stubGlobal('fetch', request); const result = await readFollowUpPages(input()); expect(result.items).toEqual([row]); expect(result.taskProgress).toBe(true); expect(request.mock.calls[0][1]?.headers).toMatchObject({ 'x-flowrish-task-progress': '1' }); expect(request.mock.calls[0][1]?.method).toBe('GET')
})
it('refuses a legacy server that silently ignores a task filter or returns malformed metadata', async () => {
 const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(false)).mockResolvedValueOnce(response(true, { ...row, taskProgress: { state: 'COMPLETED', dueDate: 'invalid' } })); vi.stubGlobal('fetch', request)
 await expect(readFollowUpPages(input())).rejects.toThrow(); await expect(readFollowUpPages(input())).rejects.toThrow(); expect(request).toHaveBeenCalledTimes(2)
})
