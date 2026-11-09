import { expect, it, vi } from 'vitest'
import { runSmoke } from '../../scripts/production-smoke.mjs'

const sha = 'a'.repeat(40)
const origin = 'https://flowrish.marckengland.com'
const html = '<!doctype html><html><body>Flowrish<form><input type="email"></form></body></html>'
const json = (commit: string | null = sha) => Response.json({ commit })
function fixture(override?: (path: string, call: number) => Response | undefined) {
  let call = 0
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input))
    const changed = override?.(url.pathname, ++call)
    if (changed) return changed
    if (url.pathname === '/release.json') return json()
    if (['/', '/login'].includes(url.pathname)) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    if (['/dashboard', '/forecast'].includes(url.pathname)) return new Response(null, { status: 307, headers: { Location: '/login' } })
    return Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 })
  })
}

it('checks the fixed production origin with anonymous GETs, no redirects, and commit confirmation on both sides', async () => {
  const fetchImpl = fixture(), log = vi.fn(), sleep = vi.fn()
  const results = await runSmoke({ expectedSha: sha, fetchImpl, log, sleep })
  expect(results).toEqual([
    { path: '/', status: 200 }, { path: '/login', status: 200 },
    { path: '/dashboard', status: 307 }, { path: '/forecast', status: 307 },
    { path: '/api/forecast', status: 401 }, { path: '/api/receptionist/home', status: 401 },
    { path: '/api/admin/website-receptionist', status: 401 },
    { path: '/api/follow-ups/11111111-1111-4111-8111-111111111111/compose-draft', status: 401 },
  ])
  expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/release.json', ...results.map(r => r.path), '/release.json'])
  for (const [url, init] of fetchImpl.mock.calls) {
    expect(new URL(String(url)).origin).toBe(origin)
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    expect(new Headers(init?.headers).has('cookie')).toBe(false)
    expect(init?.body).toBeUndefined()
  }
  expect(log).toHaveBeenCalledWith(`Production smoke passed for ${sha}.`)
  expect(sleep).not.toHaveBeenCalled()
})

it('accepts a same-origin absolute login redirect and explicit forbidden API responses', async () => {
  const fetchImpl = fixture(path => path === '/forecast' ? new Response(null, { status: 302, headers: { Location: origin + '/login' } }) : path.startsWith('/api/') ? new Response(null, { status: 403 }) : undefined)
  expect(await runSmoke({ expectedSha: sha, fetchImpl, log: vi.fn() })).toHaveLength(8)
})

it('waits through missing and old metadata with bounded retries before checking any protected route', async () => {
  const fetchImpl = fixture((path, call) => path === '/release.json' && call === 1 ? new Response(null, { status: 404 }) : path === '/release.json' && call === 2 ? json('b'.repeat(40)) : undefined)
  const sleep = vi.fn()
  await runSmoke({ expectedSha: sha, fetchImpl, sleep, log: vi.fn() })
  expect(sleep.mock.calls).toEqual([[10000], [10000]])
  expect(fetchImpl.mock.calls.slice(0, 3).every(([url]) => new URL(String(url)).pathname === '/release.json')).toBe(true)
})

it.each(['', 'not-a-sha', sha + '\n'])('refuses invalid expected metadata before any request: %j', async expectedSha => {
  const fetchImpl = fixture()
  await expect(runSmoke({ expectedSha, fetchImpl })).rejects.toThrow(/expected commit/)
  expect(fetchImpl).not.toHaveBeenCalled()
})

it.each(['null', 'old', 'malformed', 'redirect', 'extra-fields', 'large'])('fails closed after bounded metadata polling: %s', async mode => {
  const fetchImpl = fixture(() => mode === 'null' ? json(null) : mode === 'old' ? json('b'.repeat(40)) : mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://example.test' } }) : mode === 'extra-fields' ? Response.json({ commit: sha, unexpected: true }) : new Response(mode === 'large' ? 'x'.repeat(1025) : 'not json', { headers: { 'Content-Type': 'application/json' } }))
  const sleep = vi.fn(), log = vi.fn()
  await expect(runSmoke({ expectedSha: sha, fetchImpl, attempts: 2, sleep, log })).rejects.toThrow(/expected commit/)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(sleep).toHaveBeenCalledTimes(1)
  expect(log.mock.calls.flat().join(' ')).not.toContain('Production smoke passed')
})

it.each([
  ['/', 503, ''], ['/login', 200, 'not the application'], ['/dashboard', 200, 'private page'],
  ['/forecast', 307, 'https://example.test/login'], ['/forecast', 307, '/dashboard'],
  ['/api/forecast', 200, 'private data'], ['/api/receptionist/home', 500, 'private failure'],
] as const)('fails safely for an unexpected %s response (%s)', async (path, status, body) => {
  const fetchImpl = fixture(p => p === path ? new Response(status === 307 ? null : body, { status, headers: status === 307 ? { Location: body } : { 'Content-Type': 'text/html' } }) : undefined)
  const log = vi.fn()
  await expect(runSmoke({ expectedSha: sha, fetchImpl, log })).rejects.toThrow(path)
  expect(log.mock.calls.flat().join(' ')).not.toContain(body || 'synthetic-private-body')
})

it('rejects an oversized login page and withholds its body', async () => {
  const fetchImpl = fixture(path => path === '/login' ? new Response(html + 'x'.repeat(262145), { headers: { 'Content-Type': 'text/html' } }) : undefined)
  await expect(runSmoke({ expectedSha: sha, fetchImpl, log: vi.fn() })).rejects.toThrow('/login')
})

it('rejects promotion changes during the route checks', async () => {
  const fetchImpl = fixture((path, call) => path === '/release.json' && call > 1 ? json('b'.repeat(40)) : undefined)
  const log = vi.fn()
  await expect(runSmoke({ expectedSha: sha, fetchImpl, log })).rejects.toThrow(/commit changed/)
  expect(log.mock.calls.flat().join(' ')).not.toContain('Production smoke passed')
})

it('redacts transport exceptions and never forwards a response cookie', async () => {
  const secret = 'synthetic-private-transport-detail'
  const fetchImpl = vi.fn(async () => { throw new Error(secret) }), log = vi.fn(), sleep = vi.fn()
  await expect(runSmoke({ expectedSha: sha, fetchImpl, attempts: 2, sleep, log })).rejects.toThrow(/expected commit/)
  expect(log.mock.calls.flat().join(' ')).not.toContain(secret)
  const withCookie = fixture(path => path === '/' ? new Response(html, { headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'synthetic=private' } }) : undefined)
  await runSmoke({ expectedSha: sha, fetchImpl: withCookie, log: vi.fn() })
  for (const [, init] of withCookie.mock.calls) expect(new Headers(init?.headers).has('cookie')).toBe(false)
})
it('denies anonymous access to private saved compose drafts without logging their response',async()=>{const path='/api/follow-ups/11111111-1111-4111-8111-111111111111/compose-draft',fetchImpl=fixture(p=>p===path?Response.json({data:{subject:'synthetic-private-draft'} }):undefined),log=vi.fn();await expect(runSmoke({expectedSha:sha,fetchImpl,log})).rejects.toThrow(path);expect(log.mock.calls.flat().join(' ')).not.toContain('synthetic-private-draft')})
