import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), hasPermission: vi.fn(), list: vi.fn(), request: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission, hasPermission: mocks.hasPermission }))
vi.mock('@/server/services/mailbox-sync', () => ({ listMailboxSyncHealth: mocks.list, requestMailboxSync: mocks.request }))
import { GET, POST } from './route'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } })
  mocks.hasPermission.mockReturnValue(true)
  mocks.list.mockResolvedValue([])
  mocks.request.mockResolvedValue({ accountId: 'account', status: 'queued' })
})
describe('mailbox sync API', () => {
  it('scopes status to the session and reports actual write capability', async () => {
    mocks.hasPermission.mockReturnValue(false)
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], capabilities: { canWrite: false } })
    expect(mocks.list).toHaveBeenCalledWith('org', 'user')
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:read')
  })
  it('requires authentication for reads and writes', async () => {
    mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET()).status).toBe(401)
    expect((await POST(new NextRequest('https://example.com/api/email/sync', { method: 'POST' }))).status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('requires write permission before dispatching', async () => {
    mocks.permission.mockImplementation((_user, permission) => { if (permission === 'leads:write') throw new AppError('FORBIDDEN', 'Permission denied', 403) })
    expect((await POST(new NextRequest('https://example.com/api/email/sync', { method: 'POST' }))).status).toBe(403)
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('selects only the requested provider and accepts legacy empty bodies', async () => {
    const response = await POST(new NextRequest('https://example.com/api/email/sync', { method: 'POST', body: JSON.stringify({ provider: 'microsoft', organizationId: 'other' }) }))
    expect(response.status).toBe(200)
    expect(mocks.request).toHaveBeenCalledWith('org', 'user', 'microsoft')
    await POST(new NextRequest('https://example.com/api/email/sync', { method: 'POST' }))
    expect(mocks.request).toHaveBeenCalledWith('org', 'user', undefined)
  })
  it('rejects unsupported providers and malformed JSON without dispatch', async () => {
    expect((await POST(new NextRequest('https://example.com/api/email/sync', { method: 'POST', body: JSON.stringify({ provider: 'other' }) }))).status).toBe(400)
    expect((await POST(new NextRequest('https://example.com/api/email/sync', { method: 'POST', body: '{' }))).status).toBe(400)
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
