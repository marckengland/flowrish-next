import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PILOT_COOKIE_NAME } from '@/lib/pilot-onboarding'
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  status: vi.fn(),
  accept: vi.fn(),
}))
vi.mock('@/server/auth/pilot-identity', () => ({
  getPilotIdentity: mocks.identity,
}))
vi.mock('@/server/services/pilot-onboarding', () => ({
  getPilotStatus: mocks.status,
  acceptPilotInvitation: mocks.accept,
}))
import { POST as session, DELETE as clear } from '@/app/api/pilot/session/route'
import { GET as status } from '@/app/api/pilot/status/route'
import { POST as accept } from '@/app/api/pilot/accept/route'
const token = 'a'.repeat(64)
const request = (
  path: string,
  method: string,
  body?: unknown,
  origin = 'https://flowrish.example',
) =>
  new NextRequest(`https://flowrish.example${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      Cookie: `${PILOT_COOKIE_NAME}=${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.identity.mockResolvedValue({
    userId: 'synthetic',
    email: 'prospect@example.test',
    verified: true,
  })
  mocks.status.mockResolvedValue({
    state: 'ready',
    expiresAt: '2026-11-11T00:00:00.000Z',
  })
  mocks.accept.mockResolvedValue({
    state: 'joined',
    organizationName: 'Synthetic business',
    continueHref: '/receptionist/setup',
  })
})
it('exchanges only a same-origin bounded token for a private HttpOnly cookie, without checking validity or creating data', async () => {
  const response = await session(
    request('/api/pilot/session', 'POST', { token }),
  )
  expect(response.status).toBe(200)
  const cookie = response.cookies.get(PILOT_COOKIE_NAME)
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('lax')
  expect(cookie?.path).toBe('/')
  expect(cookie?.maxAge).toBe(3600)
  expect(await response.json()).toEqual({ data: { received: true } })
  expect(mocks.status).not.toHaveBeenCalled()
  expect(mocks.accept).not.toHaveBeenCalled()
  expect(mocks.identity).not.toHaveBeenCalled()
})
it('rejects foreign origin, malformed and oversized fragments before cookie creation', async () => {
  for (const req of [
    request('/api/pilot/session', 'POST', { token }, 'https://foreign.example'),
    request('/api/pilot/session', 'POST', { token: 'invalid' }),
    request('/api/pilot/session', 'POST', { token: 'a'.repeat(9000) }),
  ]) {
    const response = await session(req)
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.cookies.get(PILOT_COOKIE_NAME)).toBeUndefined()
    expect(JSON.stringify(await response.json())).not.toContain(token)
  }
})
it('clears only the pilot cookie on explicit same-origin completion', async () => {
  const response = await clear(request('/api/pilot/session', 'DELETE'))
  expect(response.cookies.get(PILOT_COOKIE_NAME)?.maxAge).toBe(0)
  expect(mocks.accept).not.toHaveBeenCalled()
})
it('returns a generic missing state without auth/DB work when there is no credential', async () => {
  const response = await status(
    new NextRequest('https://flowrish.example/api/pilot/status'),
  )
  expect(await response.json()).toEqual({ data: { state: 'missing' } })
  expect(mocks.identity).not.toHaveBeenCalled()
  expect(mocks.status).not.toHaveBeenCalled()
})
it('uses server identity and cookie, rejects foreign accept, and never accepts a client-supplied token/user', async () => {
  const response = await status(request('/api/pilot/status', 'GET'))
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.status).toHaveBeenCalledWith(token, {
    userId: 'synthetic',
    email: 'prospect@example.test',
    verified: true,
  })
  expect(
    (
      await accept(
        request(
          '/api/pilot/accept',
          'POST',
          { name: 'Synthetic', slug: 'synthetic', confirmed: true },
          'https://foreign.example',
        ),
      )
    ).status,
  ).toBe(403)
  expect(mocks.accept).not.toHaveBeenCalled()
  expect(
    (
      await accept(
        request('/api/pilot/accept', 'POST', {
          name: 'Synthetic',
          slug: 'synthetic',
          confirmed: true,
          token: 'b'.repeat(64),
          userId: 'foreign',
        }),
      )
    ).status,
  ).toBe(400)
  expect(mocks.accept).not.toHaveBeenCalled()
})
it('masks unexpected failures without logging credentials or database errors', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    mocks.status.mockRejectedValue(
      new Error(`Synthetic private error ${token}`),
    )
    const response = await status(request('/api/pilot/status', 'GET'))
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain(token)
    expect(log).not.toHaveBeenCalled()
  } finally {
    log.mockRestore()
  }
})
