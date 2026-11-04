import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
}))
vi.mock('@/server/db/client', () => ({
  prisma: { waitlist: { findUnique: mocks.findUnique, create: mocks.create } },
}))
vi.mock('@/server/services/transactional-email', () => ({
  sendTransactionalEmail: mocks.send,
  formatWaitlistConfirmationEmail: () => ({
    subject: 'Mock confirmation',
    html: '<p>Mock</p>',
  }),
}))
import { POST } from './route'
import { NextRequest } from 'next/server'
const request = (source: string) =>
  new NextRequest('https://flowrish.example/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'jamie@example.test',
      name: 'Jamie',
      source,
    }),
  })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.findUnique.mockResolvedValue(null)
  mocks.create.mockResolvedValue({ id: 'synthetic' })
})
it('records the fixed public-demo source using mocked storage and email', async () => {
  expect((await POST(request('public_demo'))).status).toBe(200)
  expect(mocks.create).toHaveBeenCalledWith({
    data: { email: 'jamie@example.test', name: 'Jamie', source: 'public_demo' },
  })
  expect(mocks.send).toHaveBeenCalledTimes(1)
})
it('rejects arbitrary source metadata before persistence or email', async () => {
  expect(
    (await POST(request('https://untrusted.example/private'))).status,
  ).toBe(400)
  expect(mocks.findUnique).not.toHaveBeenCalled()
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.send).not.toHaveBeenCalled()
})
it('preserves first attribution and the generic response on duplicate signup', async () => {
  const first = await POST(request('landing'))
  mocks.findUnique.mockResolvedValue({ id: 'synthetic' })
  const duplicate = await POST(request('public_demo'))
  expect(await duplicate.json()).toEqual(await first.json())
  expect(mocks.create).toHaveBeenCalledTimes(1)
  expect(mocks.create.mock.calls[0][0].data.source).toBe('landing')
  expect(mocks.send).toHaveBeenCalledTimes(1)
})
