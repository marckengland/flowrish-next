import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
  format: vi.fn(),
}))
vi.mock('@/server/db/client', () => ({
  prisma: { waitlist: { findUnique: mocks.findUnique, create: mocks.create } },
}))
vi.mock('@/server/services/transactional-email', () => ({
  sendTransactionalEmail: mocks.send,
  formatWaitlistConfirmationEmail: mocks.format,
}))
import { POST } from './route'

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.findUnique.mockResolvedValue(null)
  mocks.create.mockResolvedValue({ id: 'sample-entry' })
  mocks.send.mockResolvedValue(undefined)
  mocks.format.mockReturnValue({
    subject: 'Confirmation',
    html: '<p>Mock confirmation</p>',
  })
})
afterEach(() => vi.unstubAllEnvs())
describe('public waitlist contact', () => {
  it.each(['true', 'false'])(
    'captures contact with signup flag %s using mocked storage and email',
    async (flag) => {
      vi.stubEnv('WAITLIST_ENABLED', flag)
      const response = await POST(
        request({ email: ' VISITOR@example.test ', name: ' Visitor ' }),
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ data: { success: true } })
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          email: 'visitor@example.test',
          name: 'Visitor',
          source: 'landing',
        },
      })
      expect(mocks.send).toHaveBeenCalledWith({
        to: 'visitor@example.test',
        subject: 'Confirmation',
        html: '<p>Mock confirmation</p>',
      })
    },
  )
  it('does not reveal duplicate membership or resend a confirmation', async () => {
    vi.stubEnv('WAITLIST_ENABLED', 'false')
    const first = await POST(request({ email: 'visitor@example.test' }))
    mocks.findUnique.mockResolvedValue({ id: 'sample-entry' })
    const duplicate = await POST(request({ email: 'visitor@example.test' }))
    expect(duplicate.status).toBe(first.status)
    expect(await duplicate.json()).toEqual(await first.json())
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
  it('rejects invalid email before storage or email work', async () => {
    const response = await POST(request({ email: 'invalid' }))
    expect(response.status).toBe(400)
    expect(mocks.findUnique).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('keeps contact capture successful if confirmation email fails', async () => {
    mocks.send.mockRejectedValue(new Error('Mock delivery unavailable'))
    const response = await POST(request({ email: 'visitor@example.test' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { success: true } })
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
