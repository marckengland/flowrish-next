import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), options: vi.fn(), preview: vi.fn(), commit: vi.fn(), source: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/callback-handoff', () => ({ getCallbackHandoffOptions: mocks.options, previewCallbackHandoff: mocks.preview, commitCallbackHandoff: mocks.commit, getCallbackTaskSource: mocks.source }))
import { GET, POST } from './route'
import { GET as SOURCE } from '@/app/api/tasks/[id]/callback-source/route'
import { POST as PREVIEW } from './preview/route'
const context = { params: Promise.resolve({ id: 'callback' }) }
const request = (body = '{}', origin = 'https://app.example') => new Request('https://app.example/api/handoff', { method: 'POST', headers: { origin }, body })
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } }) })
describe('callback handoff HTTP boundaries', () => {
  it('uses session identity and route callback only, without creating work on read or preview', async () => {
    for (const response of [await GET(request(), context), await PREVIEW(request('{"organizationId":"forged"}'), context), await POST(request('{"confirmed":true}'), context)]) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.options).toHaveBeenCalledWith('session-org', 'admin', 'callback'); expect(mocks.preview).toHaveBeenCalledWith('session-org', 'admin', 'callback', { organizationId: 'forged' }); expect(mocks.commit).toHaveBeenCalledWith('session-org', 'admin', 'callback', { confirmed: true })
  })
  it('scopes task provenance to session identity with no cache', async () => {
    mocks.source.mockResolvedValue({ taskId: 'task', callbackId: 'callback' })
    const response = await SOURCE(request(), context); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); expect(mocks.source).toHaveBeenCalledWith('session-org', 'admin', 'callback')
  })
  it('rejects foreign or missing origins, bad JSON and oversized input before services', async () => {
    for (const origin of ['', 'null', 'https://evil.example']) expect((await POST(request('{}', origin), context)).status).toBe(403)
    expect((await PREVIEW(request('bad JSON'), context)).status).toBe(400); expect((await POST(request('x'.repeat(9000)), context)).status).toBe(413)
    expect(mocks.commit).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled()
  })
  it('requires authenticated admin and redacts unknown errors while retaining conflicts', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(request(), context)).status).toBe(401)
    mocks.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) }); expect((await GET(request(), context)).status).toBe(403)
    mocks.commit.mockRejectedValueOnce(new Error('SQL private diagnostic')); const failed = await POST(request(), context); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('SQL')
    mocks.commit.mockRejectedValue(new AppError('HANDOFF_CONFLICT', 'Review again', 409)); expect((await POST(request(), context)).status).toBe(409)
  })
})
