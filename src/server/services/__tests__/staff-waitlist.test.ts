import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const db = {
    waitlistStaffAccess: { findFirst: vi.fn() },
    waitlist: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    waitlistCrmHandoff: { findUnique: vi.fn(), create: vi.fn() },
    organization: { findUniqueOrThrow: vi.fn() },
    organizationMember: { findMany: vi.fn() },
    lead: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    stage: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { db, permissions: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: mocks.db }))
vi.mock('@/server/auth/permissions', () => ({
  getEffectivePermissions: mocks.permissions,
}))

import { assertWaitlistStaff } from '@/server/auth/waitlist-staff'
import {
  listStaffWaitlist,
  updateStaffWaitlist,
  getWaitlistHandoffOptions,
  previewWaitlistHandoff,
  commitWaitlistHandoff,
} from '../staff-waitlist'

const org = '11111111-1111-4111-8111-111111111111'
const otherOrg = '22222222-2222-4222-8222-222222222222'
const user = '33333333-3333-4333-8333-333333333333'
const id = '44444444-4444-4444-8444-444444444444'
const stageId = '55555555-5555-4555-8555-555555555555'
const leadId = '66666666-6666-4666-8666-666666666666'
const now = new Date('2026-11-04T01:00:00.000Z')
const source = () => ({
  id,
  email: 'jamie@example.test',
  name: 'Jamie Example',
  status: 'pending',
  source: 'public_demo',
  reviewStatus: 'new',
  reviewVersion: 0,
  reviewedAt: null,
  reviewedById: null,
  createdAt: now,
  updatedAt: now,
})
const draft = () => ({
  expectedVersion: 0,
  target: {
    mode: 'new',
    firstName: 'Jamie',
    lastName: 'Example',
    stageId,
    assigneeId: user,
    acknowledgeDuplicate: false,
  },
})
const receipt = () => ({
  waitlistId: id,
  organizationId: org,
  leadId,
  createdById: user,
  createdLead: true,
  createdAt: now,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db))
  mocks.db.$queryRaw.mockResolvedValue([
    { membershipId: 'grant', userId: user, id },
  ])
  mocks.db.waitlistStaffAccess.findFirst.mockResolvedValue({
    membershipId: 'grant',
  })
  mocks.db.waitlist.findUnique.mockResolvedValue(source())
  mocks.db.waitlist.findUniqueOrThrow.mockResolvedValue(source())
  mocks.db.waitlist.findMany.mockResolvedValue([source()])
  mocks.db.waitlist.updateMany.mockResolvedValue({ count: 1 })
  mocks.db.waitlistCrmHandoff.findUnique.mockResolvedValue(null)
  mocks.db.waitlistCrmHandoff.create.mockResolvedValue(receipt())
  mocks.db.organization.findUniqueOrThrow.mockResolvedValue({
    id: org,
    name: 'Flowrish',
  })
  mocks.db.organizationMember.findMany.mockResolvedValue([
    { userId: user, user: { name: 'Sample staff' } },
  ])
  mocks.db.stage.findMany.mockResolvedValue([
    {
      id: stageId,
      name: 'New',
      updatedAt: now,
      pipeline: { name: 'Sales', updatedAt: now },
    },
  ])
  mocks.db.lead.findMany.mockResolvedValue([])
  mocks.db.lead.findFirst.mockResolvedValue({
    id: leadId,
    firstName: 'Jamie',
    lastName: 'Example',
    email: 'jamie@example.test',
    updatedAt: now,
  })
  mocks.db.lead.create.mockResolvedValue({ id: leadId })
  mocks.permissions.mockResolvedValue(new Set(['leads:read', 'leads:write']))
})

describe('staff waitlist boundary and review', () => {
  it('requires an explicit live membership grant, never an organization admin role alone', async () => {
    mocks.db.waitlistStaffAccess.findFirst.mockResolvedValue(null)
    await expect(listStaffWaitlist(org, user, {})).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(mocks.db.waitlist.findMany).not.toHaveBeenCalled()
    expect(mocks.db.waitlistStaffAccess.findFirst).toHaveBeenCalledWith({
      where: { membership: { organizationId: org, userId: user } },
      select: { membershipId: true },
    })
  })
  it('checks the active organization membership when a staff user switches organizations', async () => {
    mocks.db.waitlistStaffAccess.findFirst.mockImplementation(
      async ({ where }) =>
        where.membership.organizationId === org
          ? { membershipId: 'grant' }
          : null,
    )
    await assertWaitlistStaff(org, user)
    await expect(assertWaitlistStaff(otherOrg, user)).rejects.toMatchObject({
      statusCode: 403,
    })
  })
  it('paginates bounded records with a separate review filter and safe fields', async () => {
    mocks.db.waitlist.findMany.mockResolvedValue(
      Array.from({ length: 21 }, () => source()),
    )
    const result = await listStaffWaitlist(org, user, {
      page: 2,
      reviewStatus: 'reviewed',
    })
    expect(result.entries).toHaveLength(20)
    expect(result.hasNext).toBe(true)
    expect(mocks.db.waitlist.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reviewStatus: 'reviewed' },
        skip: 20,
        take: 21,
      }),
    )
    expect(result.entries[0]).not.toHaveProperty('reviewedById')
  })
  it.each([{ page: 0 }, { page: 10001 }, { reviewStatus: 'invited' }])(
    'rejects invalid list controls %j',
    async (query) => {
      await expect(listStaffWaitlist(org, user, query)).rejects.toBeDefined()
      expect(mocks.db.waitlist.findMany).not.toHaveBeenCalled()
    },
  )
  it('marks contacted without changing invitation status or performing CRM work', async () => {
    await updateStaffWaitlist(org, user, id, {
      reviewStatus: 'contacted',
      expectedVersion: 0,
    })
    expect(mocks.db.waitlist.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, reviewVersion: 0 },
        data: expect.objectContaining({
          reviewStatus: 'contacted',
          reviewVersion: { increment: 1 },
          reviewedById: user,
        }),
      }),
    )
    expect(
      mocks.db.waitlist.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('status')
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })
  it('rejects stale review edits', async () => {
    mocks.db.waitlist.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      updateStaffWaitlist(org, user, id, {
        reviewStatus: 'reviewed',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
  it('rejects revocation at the transaction lock before a review write', async () => {
    mocks.db.$queryRaw.mockResolvedValue([])
    await expect(
      updateStaffWaitlist(org, user, id, {
        reviewStatus: 'reviewed',
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.db.waitlist.updateMany).not.toHaveBeenCalled()
  })
})

describe('approved waitlist CRM handoff', () => {
  it('returns scoped matching leads and destinations, without choosing a match', async () => {
    await getWaitlistHandoffOptions(org, user, id)
    expect(mocks.db.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: org,
          deletedAt: null,
          isClosed: false,
        }),
        take: 21,
      }),
    )
    expect(mocks.db.organizationMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: org } }),
    )
    expect(mocks.db.stage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pipeline: { organizationId: org },
          isClosedWon: false,
          isClosedLost: false,
        },
      }),
    )
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })
  it('builds a read-only preview with the destination organization and copied email', async () => {
    const preview = await previewWaitlistHandoff(org, user, id, draft())
    expect(preview).toMatchObject({
      organizationName: 'Flowrish',
      email: 'jamie@example.test',
      action: 'create',
    })
    expect(preview.version).toMatch(/^[a-f0-9]{64}$/)
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
    expect(mocks.db.waitlist.updateMany).not.toHaveBeenCalled()
  })
  it.each(['assigneeId', 'stageId'])(
    'rejects a foreign or removed %s',
    async (field) => {
      const input = draft()
      input.target[field as 'assigneeId' | 'stageId'] = otherOrg
      await expect(
        previewWaitlistHandoff(org, user, id, input),
      ).rejects.toMatchObject({ statusCode: 409 })
    },
  )
  it('does not accept a foreign, deleted, closed, or unmatched existing lead', async () => {
    await expect(
      previewWaitlistHandoff(org, user, id, {
        expectedVersion: 0,
        target: { mode: 'existing', leadId: otherOrg },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
  it('requires a separate duplicate acknowledgement before creating a lead despite a match', async () => {
    mocks.db.lead.findMany.mockResolvedValue([
      {
        id: leadId,
        firstName: 'Jamie',
        lastName: 'Existing',
        email: 'jamie@example.test',
        updatedAt: now,
      },
    ])
    await expect(
      previewWaitlistHandoff(org, user, id, draft()),
    ).rejects.toMatchObject({ statusCode: 409 })
    const input = draft()
    input.target.acknowledgeDuplicate = true
    await expect(
      previewWaitlistHandoff(org, user, id, input),
    ).resolves.toMatchObject({ action: 'create' })
  })
  it('requires current source version and CRM permissions even for explicitly granted staff', async () => {
    mocks.db.waitlist.findUnique.mockResolvedValue({
      ...source(),
      reviewVersion: 1,
    })
    await expect(
      previewWaitlistHandoff(org, user, id, draft()),
    ).rejects.toMatchObject({ statusCode: 409 })
    mocks.permissions.mockResolvedValue(new Set(['leads:read']))
    await expect(
      getWaitlistHandoffOptions(org, user, id),
    ).rejects.toMatchObject({ statusCode: 403 })
  })
  it('requires explicit approval and a fresh preview before writing', async () => {
    const preview = await previewWaitlistHandoff(org, user, id, draft())
    await expect(
      commitWaitlistHandoff(org, user, id, {
        draft: draft(),
        previewVersion: preview.version,
        confirmed: false,
      }),
    ).rejects.toBeDefined()
    await expect(
      commitWaitlistHandoff(org, user, id, {
        draft: draft(),
        previewVersion: '0'.repeat(64),
        confirmed: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })
  it('rejects source or destination changes after preview and rechecks grant revocation', async () => {
    const preview = await previewWaitlistHandoff(org, user, id, draft())
    mocks.db.waitlist.findUnique.mockResolvedValue({
      ...source(),
      email: 'changed@example.test',
    })
    await expect(
      commitWaitlistHandoff(org, user, id, {
        draft: draft(),
        previewVersion: preview.version,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    mocks.db.waitlist.findUnique.mockResolvedValue(source())
    mocks.db.waitlist.findUniqueOrThrow.mockResolvedValue(source())
    mocks.db.$queryRaw.mockResolvedValue([])
    await expect(
      commitWaitlistHandoff(org, user, id, {
        draft: draft(),
        previewVersion: preview.version,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
  })
  it('creates one lead and receipt atomically, preserving the original signup status', async () => {
    const preview = await previewWaitlistHandoff(org, user, id, draft())
    await commitWaitlistHandoff(org, user, id, {
      draft: draft(),
      previewVersion: preview.version,
      confirmed: true,
    })
    expect(mocks.db.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: org,
        firstName: 'Jamie',
        lastName: 'Example',
        email: 'jamie@example.test',
        stageId,
        assignedUserId: user,
      }),
    })
    expect(mocks.db.waitlistCrmHandoff.create).toHaveBeenCalledWith({
      data: {
        waitlistId: id,
        organizationId: org,
        leadId,
        createdById: user,
        createdLead: true,
      },
    })
    expect(
      mocks.db.waitlist.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty('status')
  })
  it('links an explicitly selected match without creating or changing an existing lead', async () => {
    mocks.db.lead.findMany.mockResolvedValue([
      {
        id: leadId,
        firstName: 'Jamie',
        lastName: 'Existing',
        email: 'jamie@example.test',
        updatedAt: now,
      },
    ])
    const input = { expectedVersion: 0, target: { mode: 'existing', leadId } }
    const preview = await previewWaitlistHandoff(org, user, id, input)
    await commitWaitlistHandoff(org, user, id, {
      draft: input,
      previewVersion: preview.version,
      confirmed: true,
    })
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
    expect(mocks.db.waitlistCrmHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leadId, createdLead: false }),
    })
  })
  it('returns the durable receipt on retries, even if the lead has since disappeared', async () => {
    mocks.db.waitlistCrmHandoff.findUnique.mockResolvedValue(receipt())
    mocks.db.lead.findFirst.mockResolvedValue(null)
    const result = await commitWaitlistHandoff(org, user, id, {
      draft: draft(),
      previewVersion: '0'.repeat(64),
      confirmed: true,
    })
    expect(result).toMatchObject({ leadId, leadAvailable: false })
    expect(mocks.db.lead.create).not.toHaveBeenCalled()
    expect(mocks.db.waitlistCrmHandoff.create).not.toHaveBeenCalled()
  })
})
