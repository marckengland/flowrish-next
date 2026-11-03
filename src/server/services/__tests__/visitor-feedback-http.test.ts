import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), policy: vi.fn(), save: vi.fn(), list: vi.fn(), change: vi.fn(), faq: vi.fn(), submit: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/visitor-feedback', () => ({ getVisitorFeedbackPolicy: mocks.policy, saveVisitorFeedbackPolicy: mocks.save, getVisitorFeedbackList: mocks.list, changeVisitorFeedback: mocks.change, createVisitorFeedbackFaq: mocks.faq }))
vi.mock('@/server/services/website-receptionist', () => ({ submitWebsiteFeedback: mocks.submit }))
import { GET as policy, PATCH as save } from '@/app/api/admin/website-receptionist/feedback-policy/route'
import { GET as list } from '@/app/api/admin/website-receptionist/feedback/route'
import { PATCH as change } from '@/app/api/admin/website-receptionist/feedback/[id]/route'
import { POST as faq } from '@/app/api/admin/website-receptionist/feedback/[id]/faq/route'
import { POST as submit } from '@/app/api/public/website-receptionist/[publicId]/feedback/route'
const id = '11111111-1111-4111-8111-111111111111', stamp = '2026-11-03T00:00:00.000Z', token = 'a'.repeat(64), route = { params: Promise.resolve({ id, publicId: id }) }
const request = (path: string, body?: unknown, headers = {}) => new Request(`https://app.example/${path}`, { ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { 'Content-Type': 'application/json', origin: 'https://app.example', 'x-forwarded-for': '192.0.2.1', ...headers } })
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'local-org', dbUser: { id: 'local-user', teamMemberships: [] } }); mocks.policy.mockResolvedValue({ configured: false, enabled: false, updatedAt: null }); mocks.list.mockResolvedValue({ rows: [], page: 1, pageSize: 20, hasMore: false }); mocks.save.mockResolvedValue({ configured: true, enabled: true, updatedAt: stamp }); mocks.change.mockResolvedValue({ saved: true }); mocks.faq.mockResolvedValue({ documentId: id, knowledgeUrl: `/knowledge?document=${id}`, available: true, created: true }); mocks.submit.mockResolvedValue({ received: true }) })
describe('visitor feedback HTTP privacy boundaries', () => {
  it('uses only the authenticated organization and user, no-store responses, and bounded validated inputs', async () => {
    expect((await policy(request('api/admin/website-receptionist/feedback-policy'))).headers.get('Cache-Control')).toBe('no-store'); expect(mocks.policy).toHaveBeenCalledWith('local-org', 'local-user')
    expect((await list(request('api/admin/website-receptionist/feedback?status=dismissed&page=2'))).status).toBe(200); expect(mocks.list).toHaveBeenCalledWith('local-org', 'local-user', { status: 'dismissed', page: 2 })
    const input = { enabled: true, acknowledged: true, expectedUpdatedAt: stamp }; expect((await save(request('policy', input))).status).toBe(200); expect(mocks.save).toHaveBeenCalledWith('local-org', 'local-user', input)
    await change(request('change', { action: 'dismiss', expectedUpdatedAt: stamp }), route); expect(mocks.change).toHaveBeenCalledWith('local-org', 'local-user', id, { action: 'dismiss', expectedUpdatedAt: stamp })
    await faq(request('faq', { expectedUpdatedAt: stamp }), route); expect(mocks.faq).toHaveBeenCalledWith('local-org', 'local-user', id, { expectedUpdatedAt: stamp })
    for (const query of ['organizationId=foreign', 'status=open&status=all', 'page=0']) expect((await list(request(`feedback?${query}`))).status).toBe(400)
    expect((await save(request('policy', { ...input, organizationId: 'foreign' }))).status).toBe(400); expect((await save(request('policy', input, { 'content-length': '9000' }))).status).toBe(413)
  })
  it('returns safe authentication, authorization, stale and unknown errors without raw diagnostics', async () => {
    mocks.session.mockRejectedValueOnce(new AppError('UNAUTHORIZED', 'Sign in required', 401)); expect((await policy(request('policy'))).status).toBe(401); expect(mocks.policy).not.toHaveBeenCalled()
    for (const status of [403, 409]) { mocks.policy.mockRejectedValueOnce(new AppError('FEEDBACK_ERROR', 'Reload feedback.', status)); const denied = await policy(request('policy')); expect(denied.status).toBe(status); expect(denied.headers.get('Cache-Control')).toBe('no-store') }
    mocks.policy.mockRejectedValueOnce(new Error('PRIVATE KEY diagnostic')); const failed = await policy(request('policy')); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('PRIVATE KEY')
  })
  it('requires a same-origin IP-bound bearer session before accepting visitor feedback', async () => {
    const body = { requestId: id, question: 'Repairs?', consented: true, website: '' }; const headers = { authorization: `Bearer ${token}` }
    const result = await submit(request('feedback', body, headers), route); expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('no-store'); expect(mocks.submit).toHaveBeenCalledWith(id, token, body, { ip: '192.0.2.1', origin: 'https://app.example' })
    for (const change of [{ authorization: '' }, { origin: 'https://evil.example' }, { 'x-forwarded-for': 'not-an-ip' }]) { expect((await submit(request('feedback', body, { ...headers, ...change }), route)).status).toBe(403) }
    expect(mocks.submit).toHaveBeenCalledOnce(); mocks.submit.mockRejectedValueOnce(new Error('PRIVATE visitor text')); const failed = await submit(request('feedback', body, headers), route); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('PRIVATE')
  })
})
