import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), save: vi.fn(), test: vi.fn() }))
vi.mock('@/server/auth/session', () => ({ requireSession: mocks.session }))
vi.mock('@/server/services/org-ai-provider', () => ({ getAiProviderSettings: mocks.get, saveAiProviderSettings: mocks.save, testAiProviderSettings: mocks.test }))
import { GET, PUT } from './route'
import { POST } from './test/route'
const version = '2026-11-02T00:00:00.000Z'
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ dbUser: { id: 'actor' }, organizationId: 'session-org' }) })
function request(body: string) { return new NextRequest('https://flowrish.example/api/admin/ai-provider', { method: 'PUT', headers: { 'content-type': 'application/json' }, body }) }
it('uses the session organization and disables caching of administrator settings', async () => {
 mocks.get.mockResolvedValue({ config: null, platformAvailable: true, usage: {} })
 const response = await GET()
 expect(response.status).toBe(200)
 expect(response.headers.get('Cache-Control')).toBe('no-store')
 expect(mocks.get).toHaveBeenCalledWith('actor', 'session-org')
 expect(mocks.test).not.toHaveBeenCalled()
})
it('requires a session before reading settings or testing credentials', async () => {
 mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED', 'Authentication required', 401))
 expect((await GET()).status).toBe(401)
 expect((await POST(request(JSON.stringify({ expectedUpdatedAt: version })))).status).toBe(401)
 expect(mocks.get).not.toHaveBeenCalled()
 expect(mocks.test).not.toHaveBeenCalled()
})
it('does not echo malformed JSON containing a credential', async () => {
 const response = await PUT(request('{"apiKey":"synthetic-private-key"'))
 expect(response.status).toBe(400)
 expect(await response.text()).not.toContain('synthetic-private-key')
 expect(mocks.save).not.toHaveBeenCalled()
})
it('does not log or return an unexpected service error containing a credential', async () => {
 const log = vi.spyOn(console, 'error').mockImplementation(() => {})
 mocks.get.mockRejectedValue(new Error('synthetic-private-key'))
 const response = await GET()
 expect(response.status).toBe(500)
 expect(await response.text()).not.toContain('synthetic-private-key')
 expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private-key')
 log.mockRestore()
})
it('tests only the saved version in the session organization and rejects extra fields', async () => {
 mocks.test.mockResolvedValue({ ok: true })
 const response = await POST(request(JSON.stringify({ expectedUpdatedAt: version })))
 expect(response.status).toBe(200)
 expect(response.headers.get('Cache-Control')).toBe('no-store')
 expect(mocks.test).toHaveBeenCalledWith('actor', 'session-org', version)
 const rejected = await POST(request(JSON.stringify({ expectedUpdatedAt: version, organizationId: 'other-org', apiKey: 'synthetic-private-key' })))
 expect(rejected.status).toBe(400)
 expect(mocks.test).toHaveBeenCalledTimes(1)
 expect(await rejected.text()).not.toContain('synthetic-private-key')
})
