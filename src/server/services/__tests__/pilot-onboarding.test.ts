import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const mocks = vi.hoisted(() => {
  const db = {
    waitlist: { findUnique: vi.fn(), updateMany: vi.fn() },
    waitlistPilotInvite: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    organizationMember: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    organization: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  }
  return { db, staff: vi.fn(), lock: vi.fn(), initialize: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: mocks.db }))
vi.mock('@/server/auth/waitlist-staff', () => ({
  assertWaitlistStaff: mocks.staff,
  lockWaitlistStaff: mocks.lock,
}))
vi.mock('@/server/services/organizations', () => ({
  createOrganization: mocks.initialize,
}))
import {
  getPilotInvitation,
  previewPilotInvitation,
  issuePilotInvitation,
  revokePilotInvitation,
  getPilotStatus,
  acceptPilotInvitation,
} from '../pilot-onboarding'
const sourceId = '11111111-1111-4111-8111-111111111111',
  staffOrg = '22222222-2222-4222-8222-222222222222',
  staff = '33333333-3333-4333-8333-333333333333',
  customer = '44444444-4444-4444-8444-444444444444',
  orgId = '55555555-5555-4555-8555-555555555555',
  requestId = '66666666-6666-4666-8666-666666666666'
const token = 'a'.repeat(64),
  hash = createHash('sha256').update(token).digest('hex')
const source = () => ({
  id: sourceId,
  email: 'prospect@example.test',
  name: 'Sample Prospect',
  status: 'pending',
  source: 'public_demo',
  reviewStatus: 'reviewed',
  reviewVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date('2026-11-04T01:00:00.000Z'),
})
const invitation = () => ({
  id: '77777777-7777-4777-8777-777777777777',
  waitlistId: sourceId,
  email: 'prospect@example.test',
  tokenHash: hash,
  issueRequestId: requestId,
  generation: 1,
  issuedById: staff,
  issuedByOrganizationId: staffOrg,
  issuedAt: new Date(Date.now() - 1000),
  expiresAt: new Date(Date.now() + 86400000),
  revokedAt: null,
  acceptedAt: null,
  acceptedById: null,
  organizationId: null,
})
const identity = () => ({
  userId: customer,
  email: 'prospect@example.test',
  verified: true,
})
const input = () => ({
  name: 'Prospect business',
  slug: 'prospect-business',
  confirmed: true,
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.staff.mockResolvedValue(undefined)
  mocks.lock.mockResolvedValue(undefined)
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db))
  mocks.db.$queryRaw.mockResolvedValue([{ id: sourceId }])
  mocks.db.waitlist.findUnique.mockResolvedValue(source())
  mocks.db.waitlist.updateMany.mockResolvedValue({ count: 1 })
  mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue(null)
  mocks.db.waitlistPilotInvite.upsert.mockImplementation(
    async ({ create }) => create,
  )
  mocks.db.waitlistPilotInvite.update.mockImplementation(async ({ data }) => ({
    ...invitation(),
    ...data,
  }))
  mocks.db.organizationMember.findMany.mockResolvedValue([])
  mocks.db.organizationMember.count.mockResolvedValue(0)
  mocks.db.organizationMember.findUnique.mockResolvedValue({
    organizationId: orgId,
    isDefault: true,
  })
  mocks.db.organization.findUnique.mockResolvedValue({
    id: orgId,
    name: 'Prospect business',
  })
  mocks.initialize.mockResolvedValue({
    organization: { id: orgId, name: 'Prospect business' },
  })
})
describe('staff-approved pilot invitation', () => {
  it('denies customer admins before reading a global signup', async () => {
    mocks.staff.mockRejectedValue(new Error('Staff access required'))
    await expect(getPilotInvitation(staffOrg, staff, sourceId)).rejects.toThrow(
      'Staff access required',
    )
    expect(mocks.db.waitlist.findUnique).not.toHaveBeenCalled()
  })
  it('exposes credential-free staff metadata and a read-only seven-day approval preview', async () => {
    const data = await getPilotInvitation(staffOrg, staff, sourceId)
    expect(data).not.toHaveProperty('tokenHash')
    expect(
      await previewPilotInvitation(staffOrg, staff, sourceId, {
        expectedVersion: 0,
      }),
    ).toMatchObject({ email: 'prospect@example.test', expiresInDays: 7 })
    expect(mocks.db.waitlistPilotInvite.upsert).not.toHaveBeenCalled()
  })
  it('stores only a hash and returns a fragment link once after explicit approval', async () => {
    const preview = await previewPilotInvitation(staffOrg, staff, sourceId, {
      expectedVersion: 0,
    })
    const result = await issuePilotInvitation(staffOrg, staff, sourceId, {
      expectedVersion: 0,
      previewVersion: preview.version,
      requestId,
      confirmed: true,
    })
    expect(result.link).toMatch(
      /^https:\/\/flowrish\.marckengland\.com\/pilot#invite=[a-f0-9]{64}$/,
    )
    const saved = mocks.db.waitlistPilotInvite.upsert.mock.calls[0][0].create
    const raw = result.link!.split('#invite=')[1]
    expect(saved.tokenHash === raw).toBe(false)
    expect(saved.tokenHash).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(saved.expiresAt.getTime() - saved.issuedAt.getTime()).toBe(
      7 * 86400000,
    )
    expect(mocks.db.waitlist.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'invited',
          reviewVersion: { increment: 1 },
        }),
      }),
    )
  })
  it('requires current preview/version, approval, and a live staff grant', async () => {
    const preview = await previewPilotInvitation(staffOrg, staff, sourceId, {
      expectedVersion: 0,
    })
    await expect(
      issuePilotInvitation(staffOrg, staff, sourceId, {
        expectedVersion: 0,
        previewVersion: preview.version,
        requestId,
        confirmed: false,
      }),
    ).rejects.toBeDefined()
    await expect(
      issuePilotInvitation(staffOrg, staff, sourceId, {
        expectedVersion: 0,
        previewVersion: '0'.repeat(64),
        requestId,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    mocks.lock.mockRejectedValue(new Error('Grant revoked'))
    await expect(
      issuePilotInvitation(staffOrg, staff, sourceId, {
        expectedVersion: 0,
        previewVersion: preview.version,
        requestId,
        confirmed: true,
      }),
    ).rejects.toThrow('Grant revoked')
    expect(mocks.db.waitlistPilotInvite.upsert).not.toHaveBeenCalled()
  })
  it('returns no plaintext and does not rotate the link when an issuance is retried', async () => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue(invitation())
    const result = await issuePilotInvitation(staffOrg, staff, sourceId, {
      expectedVersion: 0,
      previewVersion: '0'.repeat(64),
      requestId,
      confirmed: true,
    })
    expect(result.link).toBeNull()
    expect(JSON.stringify(result)).not.toContain(hash)
    expect(mocks.db.waitlistPilotInvite.upsert).not.toHaveBeenCalled()
  })
  it('requires explicit revocation before replacing an active link and never reissues a joined signup', async () => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue(invitation())
    await expect(
      previewPilotInvitation(staffOrg, staff, sourceId, { expectedVersion: 0 }),
    ).rejects.toMatchObject({ statusCode: 409 })
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      ...invitation(),
      acceptedAt: new Date(),
      acceptedById: customer,
      organizationId: orgId,
    })
    await expect(
      revokePilotInvitation(staffOrg, staff, sourceId, {
        expectedVersion: 0,
        generation: 1,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.db.waitlistPilotInvite.update).not.toHaveBeenCalled()
  })
  it('revokes only the reviewed generation and records pending without sending anything', async () => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue(invitation())
    await revokePilotInvitation(staffOrg, staff, sourceId, {
      expectedVersion: 0,
      generation: 1,
      confirmed: true,
    })
    expect(mocks.db.waitlistPilotInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    )
    expect(mocks.initialize).not.toHaveBeenCalled()
  })
})
describe('email-bound pilot redemption', () => {
  beforeEach(() => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue(invitation())
  })
  it('does not look up private invitations for an anonymous or unverified identity', async () => {
    expect(await getPilotStatus(token, null)).toEqual({ state: 'sign_in' })
    expect(
      await getPilotStatus(token, { ...identity(), verified: false }),
    ).toEqual({ state: 'sign_in' })
    expect(mocks.db.waitlistPilotInvite.findUnique).not.toHaveBeenCalled()
  })
  it('shows no metadata for a wrong email, expired or revoked token', async () => {
    expect(
      await getPilotStatus(token, {
        ...identity(),
        email: 'other@example.test',
      }),
    ).toEqual({ state: 'unavailable' })
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      ...invitation(),
      expiresAt: new Date(0),
    })
    expect(await getPilotStatus(token, identity())).toEqual({
      state: 'unavailable',
    })
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      ...invitation(),
      revokedAt: new Date(),
    })
    expect(await getPilotStatus(token, identity())).toEqual({
      state: 'unavailable',
    })
    expect(mocks.initialize).not.toHaveBeenCalled()
  })
  it('checks a ready invitation without consuming it or creating a workspace', async () => {
    expect(await getPilotStatus(token, identity())).toMatchObject({
      state: 'ready',
      expiresAt: expect.any(String),
    })
    expect(mocks.db.waitlistPilotInvite.update).not.toHaveBeenCalled()
    expect(mocks.initialize).not.toHaveBeenCalled()
  })
  it('requires verified matching identity, confirmation, and no existing membership', async () => {
    await expect(
      acceptPilotInvitation(token, { ...identity(), verified: false }, input()),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      acceptPilotInvitation(
        token,
        { ...identity(), email: 'other@example.test' },
        input(),
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      acceptPilotInvitation(token, identity(), {
        ...input(),
        confirmed: false,
      }),
    ).rejects.toBeDefined()
    mocks.db.organizationMember.count.mockResolvedValue(1)
    await expect(
      acceptPilotInvitation(token, identity(), input()),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.initialize).not.toHaveBeenCalled()
  })
  it('creates the prospect own organization inside the same transaction and marks joined', async () => {
    const result = await acceptPilotInvitation(token, identity(), input())
    expect(mocks.initialize).toHaveBeenCalledWith(
      'Prospect business',
      'prospect-business',
      customer,
      mocks.db,
    )
    expect(result).toMatchObject({
      state: 'joined',
      organizationName: 'Prospect business',
      continueHref: '/receptionist/setup',
    })
    expect(mocks.db.waitlistPilotInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          acceptedById: customer,
          organizationId: orgId,
          acceptedAt: expect.any(Date),
        }),
      }),
    )
    expect(mocks.db.waitlist.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'joined' }),
      }),
    )
  })
  it('returns the original workspace on retries and never recreates a removed membership', async () => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      ...invitation(),
      acceptedAt: new Date(),
      acceptedById: customer,
      organizationId: orgId,
    })
    expect(
      await acceptPilotInvitation(token, identity(), input()),
    ).toMatchObject({ state: 'joined', organizationName: 'Prospect business' })
    expect(mocks.initialize).not.toHaveBeenCalled()
    mocks.db.organizationMember.findUnique.mockResolvedValue(null)
    expect(await getPilotStatus(token, identity())).toEqual({
      state: 'unavailable',
    })
    await expect(
      acceptPilotInvitation(token, identity(), input()),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.initialize).not.toHaveBeenCalled()
  })
  it('does not continue into setup when another default organization conflicts', async () => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      ...invitation(),
      acceptedAt: new Date(),
      acceptedById: customer,
      organizationId: orgId,
    })
    mocks.db.organizationMember.findMany.mockResolvedValue([
      { organizationId: 'another-org', isDefault: true },
    ])
    expect(await getPilotStatus(token, identity())).toMatchObject({
      state: 'joined',
      continueHref: null,
    })
    expect(mocks.initialize).not.toHaveBeenCalled()
  })
  it('leaves invitation/status untouched if initialization fails', async () => {
    mocks.initialize.mockRejectedValue(new Error('Synthetic bootstrap failure'))
    await expect(
      acceptPilotInvitation(token, identity(), input()),
    ).rejects.toThrow('Synthetic bootstrap failure')
    expect(mocks.db.waitlistPilotInvite.update).not.toHaveBeenCalled()
    expect(mocks.db.waitlist.updateMany).not.toHaveBeenCalled()
  })
})
