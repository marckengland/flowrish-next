import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const m = vi.hoisted(() => ({
  identity: vi.fn(),
  list: vi.fn(),
  member: vi.fn(),
}))
vi.mock('@/server/auth/session', () => ({ getWorkspaceIdentity: m.identity }))
vi.mock('@/server/db/client', () => ({
  prisma: { organizationMember: { findMany: m.list, findUnique: m.member } },
}))
import { GET, POST } from '@/app/api/workspaces/route'
const id = '22222222-2222-4222-8222-222222222222'
function request(
  method = 'GET',
  body?: unknown,
  origin = 'https://flowrish.example.test',
) {
  return new NextRequest('https://flowrish.example.test/api/workspaces', {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  m.identity.mockResolvedValue({
    authUser: { id: 'auth-one' },
    dbUser: { id: 'user' },
  })
  m.list.mockResolvedValue([
    { organization: { id, name: 'Practice Business' } },
  ])
  m.member.mockResolvedValue({ organizationId: id })
})
it('lists only membership names and identifiers with private no-store caching', async () => {
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    data: { workspaces: [{ id, name: 'Practice Business' }] },
  })
  expect(m.list).toHaveBeenCalledWith({
    where: { userId: 'user' },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { organization: { name: 'asc' } },
  })
  expect(response.headers.get('cache-control')).toContain('no-store')
  expect(response.headers.has('set-cookie')).toBe(false)
})
it('sets only a user-bound secure HttpOnly selection after a fresh membership check', async () => {
  const response = await POST(request('POST', { organizationId: id }))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ data: { organizationId: id } })
  expect(m.member).toHaveBeenCalledWith({
    where: { userId_organizationId: { userId: 'user', organizationId: id } },
    select: { organizationId: true },
  })
  const cookie = response.headers.get('set-cookie')!
  expect(cookie).toContain('flowrish_workspace=auth-one%3A')
  expect(cookie).toContain('HttpOnly')
  expect(cookie).toContain('SameSite=lax')
  expect(cookie).toContain('Path=/')
  expect(m.list).not.toHaveBeenCalled()
})
it('denies foreign/revoked selection without changing cookies', async () => {
  m.member.mockResolvedValue(null)
  const response = await POST(request('POST', { organizationId: id }))
  expect(response.status).toBe(403)
  expect(response.headers.has('set-cookie')).toBe(false)
})
it('rejects anonymous, cross-origin and malformed requests without membership writes', async () => {
  expect(
    (
      await POST(
        request(
          'POST',
          { organizationId: id },
          'https://attacker.example.test',
        ),
      )
    ).status,
  ).toBe(403)
  expect(m.identity).not.toHaveBeenCalled()
  expect(
    (await POST(request('POST', { organizationId: 'invalid' }))).status,
  ).toBe(400)
  expect(m.member).not.toHaveBeenCalled()
  m.identity.mockResolvedValue(null)
  expect((await GET(request())).status).toBe(401)
  expect((await POST(request('POST', { organizationId: id }))).status).toBe(401)
})
