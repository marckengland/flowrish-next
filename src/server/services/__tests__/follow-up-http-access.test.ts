import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import { followUpHeaders } from '@/lib/follow-up-access'
const m = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: m.permission }))
import { followUpBody, followUpHttp } from '../follow-up-http'
const context = { organizationId: 'org', userId: 'actor' }
const request = (headers: Record<string, string> = followUpHeaders(context), body = '{"action":"approve"}') => new Request('https://flowrish.example.invalid/api/follow-ups/item', { method: 'PATCH', headers: { origin: 'https://flowrish.example.invalid', 'content-type': 'application/json', ...headers }, body })
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'actor' } }) })
it('requires both the captured actor and selected workspace before executing an action', async () => {
  for (const headers of [{}, followUpHeaders({ ...context, userId: 'replacement' }), { ...followUpHeaders(context), 'x-flowrish-workspace': 'other' }]) {
    const action = vi.fn(); const result = await followUpHttp(request(headers), true, action); expect(result.status).toBe(409); expect(action).not.toHaveBeenCalled(); expect(result.headers.get('cache-control')).toContain('no-store')
  }
})
it('returns current scope and write capability with no private caching', async () => {
  const result = await followUpHttp(request(), false, async () => ({ data: [{ id: 'visible' }], canWrite: false })); expect(result.status).toBe(200); expect(await result.json()).toEqual({ data: [{ id: 'visible' }], scope: context, capabilities: { canWrite: false } }); expect(result.headers.get('cache-control')).toContain('no-store'); expect(m.permission).toHaveBeenCalledWith({ id: 'actor' }, 'leads:read')
})
it('never leaks service details or falls back to an unauthorized raw result', async () => {
  const result = await followUpHttp(request(), true, async () => { throw new Error('private database or provider diagnostic') }); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain('private database'); expect(result.headers.get('cache-control')).toContain('no-store')
})
it('preserves access denials without executing a workflow', async () => {
  m.permission.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Access changed', 403) }); const action = vi.fn(); expect((await followUpHttp(request(), true, action)).status).toBe(403); expect(action).not.toHaveBeenCalled()
})
it('accepts bounded same-origin JSON and rejects cross-origin, malformed, and oversized input', async () => {
  expect(await followUpBody(request())).toEqual({ action: 'approve' }); await expect(followUpBody(request({ ...followUpHeaders(context), origin: 'https://other.example.invalid' }))).rejects.toMatchObject({ statusCode: 403 }); await expect(followUpBody(request(undefined, 'invalid'))).rejects.toMatchObject({ statusCode: 400 }); await expect(followUpBody(request(undefined, JSON.stringify({ description: 'a'.repeat(65536) })))).rejects.toMatchObject({ statusCode: 413 })
})
