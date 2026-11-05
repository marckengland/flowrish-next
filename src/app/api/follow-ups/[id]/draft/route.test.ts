import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), generate: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/follow-up-drafts', () => ({ generateFollowUpDraft: mocks.generate }))
import { POST } from './route'
const id = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } }); mocks.generate.mockResolvedValue({ id, subject: 'Draft', body: 'Reviewed later' }) })
const request = (body: unknown) => new NextRequest('https://example.com/api/follow-ups/item/draft', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json', 'x-flowrish-workspace': 'org', 'x-flowrish-follow-up-scope': JSON.stringify(['org', 'user']) }, body: JSON.stringify(body) })
describe('contextual draft API', () => {
  it('uses the current session and explicit generation instructions', async () => {
    const response = await POST(request({ instructions: 'Ask about scope', userId: 'other' }), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    expect(mocks.generate).toHaveBeenCalledWith('org','user',id,'Ask about scope')
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:read')
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'user' }, 'leads:write')
  })
  it('requires authentication and write access before generation', async () => {
    mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED','Sign in',401))
    expect((await POST(request({}), { params: Promise.resolve({ id }) })).status).toBe(401)
    mocks.session.mockResolvedValue({ organizationId: 'org', dbUser: { id: 'user' } })
    mocks.permission.mockImplementation((_user, permission) => { if (permission === 'leads:write') throw new AppError('FORBIDDEN','No access',403) })
    expect((await POST(request({}), { params: Promise.resolve({ id }) })).status).toBe(403)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects oversized instructions and malformed identities', async () => {
    expect((await POST(request({ instructions: 'x'.repeat(2001) }), { params: Promise.resolve({ id }) })).status).toBe(400)
    expect((await POST(request({}), { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
