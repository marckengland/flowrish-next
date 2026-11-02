import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), list: vi.fn(), detail: vi.fn(), review: vi.fn(), faq: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/knowledge-gaps', () => ({ getKnowledgeGapList: mocks.list, getKnowledgeGapDetail: mocks.detail, reviewKnowledgeGap: mocks.review, createKnowledgeGapFaq: mocks.faq }))
import { GET } from './route'
import { GET as DETAIL, PATCH } from './[key]/route'
import { POST } from './[key]/faq/route'
const key = 'a'.repeat(64), context = { params: Promise.resolve({ key }) }
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } }) })
describe('knowledge gaps API', () => {
  it('uses session identity and preserves strict query/body objects for service validation', async () => {
    mocks.list.mockResolvedValue({ groups: [] }); mocks.detail.mockResolvedValue({ group: {} }); mocks.review.mockResolvedValue({ group: {} }); mocks.faq.mockResolvedValue({ created: false })
    const review = { expectedVersion: key, action: 'resolve', retested: true, notes: 'Checked' }
    const responses = [await GET(new Request('http://localhost/?status=all&page=2')), await DETAIL(new Request('http://localhost/?page=3'), context), await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(review) }), context), await POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ expectedVersion: key }) }), context)]
    for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store') }
    expect(mocks.list).toHaveBeenCalledWith('session-org', 'admin', { status: 'all', page: '2' })
    expect(mocks.detail).toHaveBeenCalledWith('session-org', 'admin', key, { page: '3' })
    expect(mocks.review).toHaveBeenCalledWith('session-org', 'admin', key, review)
    expect(mocks.faq).toHaveBeenCalledWith('session-org', 'admin', key, { expectedVersion: key })
  })
  it('rejects duplicate/oversized queries and malformed/oversized bodies', async () => {
    expect((await GET(new Request('http://localhost/?page=1&page=2'))).status).toBe(400)
    expect((await GET(new Request(`http://localhost/?status=${'x'.repeat(300)}`))).status).toBe(400)
    expect((await PATCH(new Request('http://localhost', { method: 'PATCH', body: 'broken JSON' }), context)).status).toBe(400)
    expect((await POST(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(110 * 1024) }), context)).status).toBe(413)
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.faq).not.toHaveBeenCalled()
  })
  it('requires authentication/permission and preserves known stale conflicts', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await GET(new Request('http://localhost'))).status).toBe(401)
    mocks.permission.mockImplementationOnce(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) })
    expect((await DETAIL(new Request('http://localhost'), context)).status).toBe(403)
    mocks.review.mockRejectedValue(new AppError('KNOWLEDGE_GAP_CONFLICT', 'Reload saved question.', 409))
    expect((await PATCH(new Request('http://localhost', { method: 'PATCH', body: '{}' }), context)).status).toBe(409)
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled()
  })
})
