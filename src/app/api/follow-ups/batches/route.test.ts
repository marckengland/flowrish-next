import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), save: vi.fn(), list: vi.fn(), read: vi.fn(), attempt: vi.fn(), complete: vi.fn(), reschedule: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
vi.mock('@/server/services/follow-up-task-batches', () => ({ saveTaskBatch: m.save, listTaskBatches: m.list, readTaskBatch: m.read, withTaskBatchAttempt: m.attempt }))
vi.mock('@/server/services/follow-up-task-completion', () => ({ completeFollowUpTask: m.complete }))
vi.mock('@/server/services/follow-up-task-reschedule', () => ({ rescheduleFollowUpTask: m.reschedule }))
import { GET, POST } from './route'
import { GET as detail } from './[id]/route'
import { POST as complete } from '../[id]/task-completion/route'
import { POST as reschedule } from '../[id]/task-reschedule/route'
const id = '22222222-2222-4222-8222-222222222222', context = { params: Promise.resolve({ id }) }
function request(method = 'GET', path = '', body?: unknown) { return new Request('https://app.example/api/follow-ups/batches' + path, { method, headers: { origin: 'https://app.example', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'actor']) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'actor' } }); m.attempt.mockImplementation(async (_o, _u, _b, _k, _i, _raw, run) => run()) })
it('uses session-owned read and write scopes with no-store responses', async () => {
 for (const res of [await GET(request()), await detail(request(), context), await POST(request('POST', '', {}))]) { expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toContain('no-store'); expect((await res.json()).scope).toEqual({ organizationId: 'org', userId: 'actor' }) }
 expect(m.list).toHaveBeenCalledWith('org', 'actor', undefined); expect(m.read).toHaveBeenCalledWith('org', 'actor', id); expect(m.save).toHaveBeenCalledWith('org', 'actor', {})
 expect(m.permission).toHaveBeenCalledWith({ id: 'actor' }, 'leads:write')
})
it('rejects anonymous, stale context, foreign origin and invalid query before services', async () => {
 m.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(request())).status).toBe(401)
 const stale = request(); stale.headers.set('x-flowrish-workspace', 'other'); expect((await GET(stale)).status).toBe(409)
 const foreign = request('POST', '', {}); foreign.headers.set('origin', 'https://other.invalid'); expect((await POST(foreign)).status).toBe(403)
 for (const query of ['?cursor=x&cursor=y', '?userId=other']) expect((await GET(request('GET', query))).status).toBe(400)
 expect((await detail(request('GET', '?requestId=x'), context)).status).toBe(400)
 expect(m.list).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled()
})
it('conditionally fences existing task POSTs and keeps single operations compatible', async () => {
 for (const [route, kind] of [[complete, 'COMPLETE'], [reschedule, 'RESCHEDULE']] as const) {
  const req = request('POST', '', { taskId: 'task' }); req.headers.set('x-flowrish-task-batch', id)
  expect((await route(req, context)).status).toBe(200)
  expect(m.attempt).toHaveBeenLastCalledWith('org', 'actor', id, kind, id, { taskId: 'task' }, expect.any(Function))
 }
 expect(m.complete).toHaveBeenCalledTimes(1); expect(m.reschedule).toHaveBeenCalledTimes(1)
 await complete(request('POST', '', {}), context); expect(m.attempt).toHaveBeenCalledTimes(2)
 const bad = request('POST', '', {}); bad.headers.set('x-flowrish-task-batch', 'bad'); expect((await complete(bad, context)).status).toBe(400); expect(m.complete).toHaveBeenCalledTimes(2)
})
