import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), preview: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/auth/permissions', () => ({ requirePermission: mocks.permission }))
vi.mock('@/server/services/receptionist-preview', () => ({ previewReceptionist: mocks.preview }))
import { POST } from './route'

const request = (body = '{}') => new NextRequest('https://crm.test/api/admin/receptionist/preview', { method: 'POST', body })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } })
  mocks.preview.mockResolvedValue({ reply: 'Synthetic greeting', sources: [] })
})

describe('authenticated preview route', () => {
  it('requires a session and settings permission before accessing preview', async () => {
    mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Authentication required', 401))
    expect((await POST(request())).status).toBe(401)
    expect(mocks.permission).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue({ organizationId: 'session-org', dbUser: { id: 'admin' } })
    mocks.permission.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Forbidden', 403) })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('uses only the session organization and user and disables caching', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.permission).toHaveBeenCalledWith({ id: 'admin' }, 'admin:settings')
    expect(mocks.preview).toHaveBeenCalledWith('session-org', 'admin', {})
    expect(await response.json()).toEqual({ data: { reply: 'Synthetic greeting', sources: [] } })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rejects malformed JSON without calling the service', async () => {
    const response = await POST(request('{'))
    expect(response.status).toBe(400)
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('rejects oversized streamed bodies even without content-length', async () => {
    const response = await POST(request(JSON.stringify({ speech: 'x'.repeat(65537) })))
    expect(response.status).toBe(413)
    expect(mocks.preview).not.toHaveBeenCalled()
  })

  it('preserves actionable service errors', async () => {
    mocks.preview.mockRejectedValue(new AppError('PREVIEW_STALE', 'Start a new preview.', 409))
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'PREVIEW_STALE', message: 'Start a new preview.' } })
  })
})
