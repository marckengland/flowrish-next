import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), detail: vi.fn(), preview: vi.fn(), record: vi.fn(), resolve: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/callback-outcomes', () => ({ listCallbackOutcomeQueue: mocks.list, getCallbackOutcome: mocks.detail, previewCallbackOutcome: mocks.preview, recordCallbackOutcome: mocks.record, resolveCallbackOutcomeTask: mocks.resolve }))
import { GET as LIST } from './route'
import { GET, POST } from './[id]/route'
import { POST as PREVIEW } from './[id]/preview/route'
import { GET as TASK, POST as TASK_POST } from '@/app/api/tasks/[id]/callback-outcomes/route'
import { POST as TASK_PREVIEW } from '@/app/api/tasks/[id]/callback-outcomes/preview/route'
const context = { params: Promise.resolve({ id: 'route-id' }) }
function request(body = '{}', origin = 'https://app.example') { return new Request('https://app.example/api/outcomes', { method: 'POST', headers: { origin }, body }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'staff' } }); mocks.resolve.mockResolvedValue('resolved-callback') })
describe('authenticated callback outcome routes', () => {
  it('uses session identity for detail, queue and preview/commit without an admin-only gate', async () => {
    const responses = [await LIST(new Request('https://app.example/?filter=open&page=2')), await GET(new Request('https://app.example/?before=21'), context), await PREVIEW(request('{"draft":{}}'), context), await POST(request('{"confirmed":true}'), context)]
    for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.list).toHaveBeenCalledWith('session-org', 'staff', { filter: 'open', page: '2' }); expect(mocks.detail).toHaveBeenCalledWith('session-org', 'staff', 'route-id', { before: '21' }); expect(mocks.preview).toHaveBeenCalledWith('session-org', 'staff', 'route-id', { draft: {} }); expect(mocks.record).toHaveBeenCalledWith('session-org', 'staff', 'route-id', { confirmed: true })
  })
  it('resolves task aliases within the session organization for every operation', async () => {
    for (const response of [await TASK(new Request('https://app.example'), context), await TASK_PREVIEW(request(), context), await TASK_POST(request(), context)]) expect(response.status).toBe(200)
    expect(mocks.resolve).toHaveBeenCalledTimes(3); expect(mocks.resolve).toHaveBeenCalledWith('session-org', 'staff', 'route-id'); expect(mocks.record).toHaveBeenCalledWith('session-org', 'staff', 'resolved-callback', {})
  })
  it('rejects missing/foreign origins, oversized/malformed bodies and duplicate query values', async () => {
    for (const origin of ['', 'null', 'https://evil.example']) expect((await POST(request('{}', origin), context)).status).toBe(403)
    expect((await PREVIEW(request('broken JSON'), context)).status).toBe(400); expect((await POST(request('x'.repeat(9000)), context)).status).toBe(413); expect((await LIST(new Request('https://app.example/?page=1&page=2'))).status).toBe(400)
    expect((await TASK_POST(request('{}', 'https://evil.example'), context)).status).toBe(403); expect((await TASK_PREVIEW(request('{}', 'https://evil.example'), context)).status).toBe(403); expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled()
  })
  it('preserves auth/conflict statuses and redacts unknown errors', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in', 401)); expect((await GET(new Request('https://app.example'), context)).status).toBe(401)
    mocks.record.mockRejectedValueOnce(new AppError('OUTCOME_CONFLICT', 'Reload', 409)); expect((await POST(request(), context)).status).toBe(409)
    mocks.detail.mockRejectedValue(new Error('Private SQL diagnostic')); const result = await GET(new Request('https://app.example'), context); expect(result.status).toBe(503); expect(await result.text()).not.toContain('SQL')
  })
})
