import { beforeEach, expect, it, vi } from 'vitest'
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  user: vi.fn(),
  cookie: '',
  headers: new Headers(),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (m.cookie ? { value: m.cookie } : undefined),
  }),
  headers: async () => m.headers,
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: m.auth } }),
}))
vi.mock('@/server/db/client', () => ({
  prisma: { user: { findUnique: m.user } },
}))
import { getSession } from '../session'
beforeEach(() => {
  vi.clearAllMocks()
  m.cookie = ''
  m.headers = new Headers()
  m.auth.mockResolvedValue({ data: { user: { id: 'auth-one' } } })
  m.user.mockResolvedValue({
    id: 'user',
    organizationMemberships: [
      { organizationId: a, isDefault: true },
      { organizationId: b, isDefault: false },
    ],
    teamMemberships: [
      { team: { organizationId: a }, role: { hierarchy: 0 } },
      { team: { organizationId: b }, role: { hierarchy: 3 } },
    ],
  })
})
it('selects a retained membership and only that business role without changing the default', async () => {
  m.cookie = `auth-one:${b}`
  const session = await getSession()
  expect(session?.organizationId).toBe(b)
  expect(session?.dbUser.teamMemberships.map((x) => x.role.hierarchy)).toEqual([
    3,
  ])
  expect(
    session?.dbUser.organizationMemberships.find((x) => x.isDefault)
      ?.organizationId,
  ).toBe(a)
})
it('ignores another signed-in user selection and malformed cookies', async () => {
  for (const cookie of [`someone-else:${b}`, 'broken']) {
    m.cookie = cookie
    expect((await getSession())?.organizationId).toBe(a)
  }
})
it('rejects stale reads and writes instead of retargeting them to the new business', async () => {
  m.cookie = `auth-one:${b}`
  for (const method of ['GET', 'POST', 'PATCH']) {
    m.headers = new Headers({
      'x-flowrish-workspace': a,
      'x-flowrish-request-method': method,
      'x-flowrish-request-path': '/api/tasks',
    })
    await expect(getSession()).rejects.toMatchObject({
      code: 'WORKSPACE_CHANGED',
      statusCode: 409,
    })
  }
})
it('rejects unbound native writes after switching and accepts correctly bound writes', async () => {
  m.cookie = `auth-one:${b}`
  m.headers.set('x-flowrish-request-method', 'POST')
  await expect(getSession()).rejects.toMatchObject({
    code: 'WORKSPACE_CONTEXT_REQUIRED',
    statusCode: 409,
  })
  m.headers.set('x-flowrish-workspace', b)
  expect((await getSession())?.organizationId).toBe(b)
})
it('denies revoked selection for APIs and sends a document navigation to the chooser', async () => {
  m.cookie = 'auth-one:33333333-3333-4333-8333-333333333333'
  m.headers = new Headers({
    'x-flowrish-request-method': 'GET',
    'x-flowrish-request-path': '/api/tasks',
  })
  await expect(getSession()).rejects.toMatchObject({
    code: 'WORKSPACE_ACCESS_REVOKED',
    statusCode: 403,
  })
  m.headers.set('x-flowrish-request-path', '/dashboard')
  await expect(getSession()).rejects.toThrow('redirect:/workspaces')
})
it('does not allow a default-page request to write after another tab selects a business', async () => {
  m.cookie = `auth-one:${b}`
  m.headers = new Headers({
    'x-flowrish-workspace': 'default',
    'x-flowrish-request-method': 'POST',
  })
  await expect(getSession()).rejects.toMatchObject({
    code: 'WORKSPACE_CHANGED',
  })
})
