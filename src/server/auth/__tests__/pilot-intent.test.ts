import { beforeEach, expect, it, vi } from 'vitest'
const findFirst = vi.hoisted(() => vi.fn())
vi.mock('@/server/db/client', () => ({
  prisma: { waitlistPilotInvite: { findFirst } },
}))
import { hasPilotInvitationForEmail } from '../pilot-intent'
beforeEach(() => vi.clearAllMocks())
it('looks up only invitation existence for normalized verified email', async () => {
  findFirst.mockResolvedValue({ id: 'synthetic' })
  expect(await hasPilotInvitationForEmail(' Prospect@Example.test ')).toBe(true)
  expect(findFirst).toHaveBeenCalledWith({
    where: { email: 'prospect@example.test' },
    select: { id: true },
  })
})
it('returns false for missing records and never queries empty email', async () => {
  findFirst.mockResolvedValue(null)
  expect(await hasPilotInvitationForEmail('prospect@example.test')).toBe(false)
  findFirst.mockClear()
  expect(await hasPilotInvitationForEmail(' ')).toBe(false)
  expect(findFirst).not.toHaveBeenCalled()
})
