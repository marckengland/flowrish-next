import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({
  session: vi.fn(),
  gmail: vi.fn(),
  microsoft: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ requireSession: m.session }))
vi.mock('@/server/services/email', () => ({ connectGmail: m.gmail }))
vi.mock('@/server/services/microsoft-email', () => ({
  connectMicrosoft: m.microsoft,
}))
import { POST } from '@/app/api/email/oauth/start/route'
import { GET as gmail } from '@/app/api/email/callback/route'
import { GET as microsoft } from '@/app/api/email/microsoft/callback/route'
const origin = 'https://flowrish.example.test'
function session(org = 'one') {
  return {
    organizationId: org,
    authUser: { id: 'auth-one' },
    dbUser: {
      id: 'user',
      teamMemberships: [{ role: { permissions: [{ key: 'leads:write' }] } }],
    },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  m.session.mockResolvedValue(session())
  m.gmail.mockResolvedValue({ email: 'practice@example.test' })
  m.microsoft.mockResolvedValue({ email: 'practice@example.test' })
})
async function start(provider: string) {
  const response = await POST(
    new NextRequest(`${origin}/api/email/oauth/start`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
    }),
  )
  const body = await response.json()
  return {
    response,
    state: body.data.state as string,
    cookie: response.headers.get('set-cookie')!.split(';')[0],
  }
}
for (const provider of ['gmail', 'microsoft'] as const) {
  const callback = provider === 'gmail' ? gmail : microsoft
  const path =
    provider === 'gmail'
      ? '/api/email/callback'
      : '/api/email/microsoft/callback'
  it(`${provider} binds a short-lived initiation to the user and starting business and consumes it`, async () => {
    const initial = await start(provider)
    expect(initial.state.length).toBeGreaterThanOrEqual(32)
    expect(initial.response.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(initial.response.headers.get('set-cookie')).toMatch(/Secure/)
    expect(initial.response.headers.get('cache-control')).toContain('no-store')
    const response = await callback(
      new NextRequest(
        `${origin}${path}?code=synthetic-code&state=${initial.state}`,
        { headers: { cookie: initial.cookie } },
      ),
    )
    expect(await response.text()).toContain(`${provider}-oauth-success`)
    expect(
      provider === 'gmail' ? m.gmail : m.microsoft,
    ).toHaveBeenCalledExactlyOnceWith(
      'synthetic-code',
      'user',
      'one',
      `${origin}${path}`,
    )
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
  it(`${provider} rejects a switch, different user, missing/mismatched state and expired initiation before provider work`, async () => {
    const initial = await start(provider)
    for (const current of [
      session('two'),
      { ...session(), authUser: { id: 'other-user' } },
    ]) {
      m.session.mockResolvedValue(current)
      expect(
        await (
          await callback(
            new NextRequest(
              `${origin}${path}?code=synthetic-code&state=${initial.state}`,
              { headers: { cookie: initial.cookie } },
            ),
          )
        ).text(),
      ).toContain(`${provider}-oauth-error`)
    }
    m.session.mockResolvedValue(session())
    for (const suffix of ['', '&state=wrong-state'])
      await callback(
        new NextRequest(`${origin}${path}?code=synthetic-code${suffix}`, {
          headers: { cookie: initial.cookie },
        }),
      )
    await callback(
      new NextRequest(
        `${origin}${path}?code=synthetic-code&state=${initial.state}`,
      ),
    )
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    try {
      await callback(
        new NextRequest(
          `${origin}${path}?code=synthetic-code&state=${initial.state}`,
          { headers: { cookie: initial.cookie } },
        ),
      )
    } finally {
      vi.useRealTimers()
    }
    expect(m.gmail).not.toHaveBeenCalled()
    expect(m.microsoft).not.toHaveBeenCalled()
  })
}
it('does not start consent from a foreign origin or without write permission', async () => {
  expect(
    (
      await POST(
        new NextRequest(`${origin}/api/email/oauth/start`, {
          method: 'POST',
          headers: { origin: 'https://foreign.example.test' },
          body: '{"provider":"gmail"}',
        }),
      )
    ).status,
  ).toBe(403)
  expect(m.session).not.toHaveBeenCalled()
  m.session.mockResolvedValue({
    ...session(),
    dbUser: { id: 'user', teamMemberships: [] },
  })
  expect(
    (
      await POST(
        new NextRequest(`${origin}/api/email/oauth/start`, {
          method: 'POST',
          headers: { origin },
          body: '{"provider":"gmail"}',
        }),
      )
    ).status,
  ).toBe(403)
})
it('keeps provider internals out of popup error pages', async () => {
  const initial = await start('gmail')
  m.gmail.mockRejectedValue(new Error('synthetic-sensitive-provider-internals'))
  const response = await gmail(
    new NextRequest(
      `${origin}/api/email/callback?code=synthetic-code&state=${initial.state}`,
      { headers: { cookie: initial.cookie } },
    ),
  )
  const html = await response.text()
  expect(html).toContain('gmail-oauth-error')
  expect(html).not.toContain('synthetic-sensitive-provider-internals')
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
})
