import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'
vi.mock('@/server/db/client', async () => {
  const raw = process.env.PILOT_TEST_DATABASE_URL
  if (!raw) throw new Error('Explicit disposable pilot database URL required.')
  const url = new URL(raw)
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== 'postgres' ||
    url.password !== 'mock-only' ||
    url.pathname !== '/postgres'
  )
    throw new Error(
      'Only the disposable loopback database with dummy credentials is permitted.',
    )
  const { PrismaClient } = await import('@prisma/client')
  return {
    prisma: new PrismaClient({ datasources: { db: { url: raw } }, log: [] }),
  }
})
import { prisma } from '@/server/db/client'
import { assertWaitlistStaff } from '@/server/auth/waitlist-staff'
import {
  getPilotInvitation,
  previewPilotInvitation,
  issuePilotInvitation,
  revokePilotInvitation,
  getPilotStatus,
  acceptPilotInvitation,
} from '@/server/services/pilot-onboarding'
const staffOrg = randomUUID(),
  staff = randomUUID(),
  prospect = randomUUID(),
  wrongUser = randomUUID(),
  membership = randomUUID(),
  prefix = `mock-pilot-${randomUUID().slice(0, 8)}`
let id: string
const sourceIds: string[] = []
const identity = () => ({
  userId: prospect,
  email: 'prospect@example.test',
  verified: true,
})
const form = () => ({
  name: 'Synthetic Prospect business',
  slug: `${prefix}-business`,
  confirmed: true,
})
beforeAll(async () => {
  await prisma.organization.create({
    data: {
      id: staffOrg,
      name: 'Synthetic Flowrish staff',
      slug: `${prefix}-staff`,
    },
  })
  await prisma.user.createMany({
    data: [
      {
        id: staff,
        authId: randomUUID(),
        email: `${staff}@example.test`,
        name: 'Synthetic Staff',
      },
      {
        id: prospect,
        authId: randomUUID(),
        email: 'prospect@example.test',
        name: 'Synthetic Prospect',
      },
      {
        id: wrongUser,
        authId: randomUUID(),
        email: 'wrong@example.test',
        name: 'Synthetic Other',
      },
    ],
  })
  await prisma.organizationMember.create({
    data: {
      id: membership,
      userId: staff,
      organizationId: staffOrg,
      isDefault: true,
    },
  })
})
beforeEach(async () => {
  await prisma.waitlistStaffAccess.upsert({
    where: { membershipId: membership },
    create: { membershipId: membership },
    update: {},
  })
  id = randomUUID()
  sourceIds.push(id)
  await prisma.waitlist.create({
    data: {
      id,
      email: 'prospect@example.test',
      name: 'Synthetic Prospect',
      source: 'public_demo',
    },
  })
})
afterEach(async () => {
  await prisma.waitlistPilotInvite.deleteMany({
    where: { waitlistId: { in: sourceIds } },
  })
  await prisma.waitlist.deleteMany({ where: { id: { in: sourceIds } } })
  const orgs = await prisma.organization.findMany({
      where: { slug: { startsWith: prefix }, id: { not: staffOrg } },
      select: { id: true },
    }),
    orgIds = orgs.map((row) => row.id)
  await prisma.teamMember.deleteMany({
    where: { team: { organizationId: { in: orgIds } } },
  })
  await prisma.organizationMember.deleteMany({
    where: { OR: [{ organizationId: { in: orgIds } }, { userId: prospect }] },
  })
  await prisma.team.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.role.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
})
afterAll(async () => {
  await prisma.organizationMember.deleteMany({
    where: { organizationId: staffOrg },
  })
  await prisma.organization.delete({ where: { id: staffOrg } })
  await prisma.user.deleteMany({
    where: { id: { in: [staff, prospect, wrongUser] } },
  })
  await prisma.$disconnect()
})
async function issue(sourceId = id) {
  const meta = await getPilotInvitation(staffOrg, staff, sourceId),
    preview = await previewPilotInvitation(staffOrg, staff, sourceId, {
      expectedVersion: meta.entry.reviewVersion,
    })
  const raw = {
    expectedVersion: meta.entry.reviewVersion,
    previewVersion: preview.version,
    requestId: randomUUID(),
    confirmed: true,
  }
  const result = await issuePilotInvitation(staffOrg, staff, sourceId, raw)
  const token = new URLSearchParams(new URL(result.link!).hash.slice(1)).get(
    'invite',
  )!
  return { token, raw, result }
}
it('issues hash-only authority once, handles uncertain retries, and invalidates a revoked generation', async () => {
  const first = await issue()
  const row = await prisma.waitlistPilotInvite.findUniqueOrThrow({
    where: { waitlistId: id },
  })
  expect(row.tokenHash === first.token).toBe(false)
  const retry = await issuePilotInvitation(staffOrg, staff, id, first.raw)
  expect(retry.link).toBeNull()
  expect(retry.invitation?.generation).toBe(1)
  const meta = await getPilotInvitation(staffOrg, staff, id)
  expect(JSON.stringify(meta)).not.toContain(first.token)
  await revokePilotInvitation(staffOrg, staff, id, {
    expectedVersion: meta.entry.reviewVersion,
    generation: 1,
    confirmed: true,
  })
  const second = await issue()
  expect(second.result.invitation?.generation).toBe(2)
  expect(await getPilotStatus(first.token, identity())).toEqual({
    state: 'unavailable',
  })
  expect(await getPilotStatus(second.token, identity())).toMatchObject({
    state: 'ready',
  })
})
it('does not consume on GET, rejects wrong/unverified email, expired links and revoked staff grants', async () => {
  const link = await issue()
  expect(await getPilotStatus(link.token, null)).toEqual({ state: 'sign_in' })
  expect(
    await getPilotStatus(link.token, {
      userId: wrongUser,
      email: 'wrong@example.test',
      verified: true,
    }),
  ).toEqual({ state: 'unavailable' })
  await expect(
    acceptPilotInvitation(
      link.token,
      { ...identity(), verified: false },
      form(),
    ),
  ).rejects.toMatchObject({ statusCode: 403 })
  await prisma.waitlistPilotInvite.update({
    where: { waitlistId: id },
    data: {
      issuedAt: new Date(Date.now() - 8 * 86400000),
      expiresAt: new Date(Date.now() - 1000),
    },
  })
  await expect(
    acceptPilotInvitation(link.token, identity(), form()),
  ).rejects.toMatchObject({ statusCode: 403 })
  expect(await prisma.organization.count()).toBe(1)
  await prisma.waitlistStaffAccess.delete({
    where: { membershipId: membership },
  })
  await expect(getPilotInvitation(staffOrg, staff, id)).rejects.toMatchObject({
    statusCode: 403,
  })
})
it('creates exactly one separate owner workspace under concurrent acceptance and grants no platform access', async () => {
  const link = await issue()
  const results = await Promise.all([
    acceptPilotInvitation(link.token, identity(), form()),
    acceptPilotInvitation(link.token, identity(), form()),
  ])
  expect(results.every((row) => row.state === 'joined')).toBe(true)
  const receipt = await prisma.waitlistPilotInvite.findUniqueOrThrow({
    where: { waitlistId: id },
  })
  expect(receipt.organizationId === staffOrg).toBe(false)
  expect(await prisma.organization.count()).toBe(2)
  expect(
    await prisma.aiProviderConfig.count({
      where: { organizationId: receipt.organizationId! },
    }),
  ).toBe(0)
  expect(
    await prisma.knowledgeDocument.count({
      where: { organizationId: receipt.organizationId! },
    }),
  ).toBe(0)
  expect(
    await prisma.websiteReceptionistConfig.count({
      where: { organizationId: receipt.organizationId!, enabled: true },
    }),
  ).toBe(0)
  const members = await prisma.organizationMember.findMany({
    where: { userId: prospect },
  })
  expect(members).toHaveLength(1)
  expect(members[0]).toMatchObject({
    organizationId: receipt.organizationId,
    isDefault: true,
  })
  const team = await prisma.teamMember.findFirstOrThrow({
    where: { userId: prospect },
    include: { team: true, role: { include: { permissions: true } } },
  })
  expect(team.team.name).toBe('General')
  expect(team.role.name).toBe('OWNER')
  expect(team.role.organizationId).toBe(receipt.organizationId)
  expect(team.role.permissions.map((row) => row.key)).toEqual(
    expect.arrayContaining(['admin:settings', 'leads:write']),
  )
  expect(
    await prisma.waitlistStaffAccess.count({
      where: { membershipId: members[0].id },
    }),
  ).toBe(0)
  await expect(
    assertWaitlistStaff(receipt.organizationId!, prospect),
  ).rejects.toMatchObject({ statusCode: 403 })
  expect(await prisma.waitlist.findUnique({ where: { id } })).toMatchObject({
    status: 'joined',
  })
  const retry = await acceptPilotInvitation(link.token, identity(), form())
  expect(retry).toMatchObject({
    state: 'joined',
    continueHref: '/receptionist/setup',
  })
  await prisma.teamMember.deleteMany({ where: { userId: prospect } })
  await prisma.organizationMember.deleteMany({ where: { userId: prospect } })
  await expect(
    acceptPilotInvitation(link.token, identity(), form()),
  ).rejects.toMatchObject({ statusCode: 403 })
  expect(await prisma.organization.count()).toBe(2)
})
it('rolls back organization, team, invitation and signup when role initialization fails, then permits a safe retry', async () => {
  const link = await issue()
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Role" ADD CONSTRAINT mock_pilot_bootstrap_failure CHECK ("organizationId" IS NULL OR "organizationId"='${staffOrg}')`,
  )
  try {
    await expect(
      acceptPilotInvitation(link.token, identity(), form()),
    ).rejects.toBeDefined()
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "Role" DROP CONSTRAINT mock_pilot_bootstrap_failure',
    )
  }
  expect(await prisma.organization.count()).toBe(1)
  expect(await prisma.team.count()).toBe(0)
  expect(
    await prisma.waitlistPilotInvite.findUnique({ where: { waitlistId: id } }),
  ).toMatchObject({ acceptedAt: null, organizationId: null })
  expect(await prisma.waitlist.findUnique({ where: { id } })).toMatchObject({
    status: 'invited',
  })
  expect(
    await acceptPilotInvitation(link.token, identity(), form()),
  ).toMatchObject({ state: 'joined' })
})
it('leaves an existing membership unchanged and never adds the prospect to the staff workspace', async () => {
  const link = await issue()
  const existing = await prisma.organizationMember.create({
    data: { userId: prospect, organizationId: staffOrg, isDefault: false },
  })
  expect(await getPilotStatus(link.token, identity())).toEqual({
    state: 'existing_workspace',
  })
  await expect(
    acceptPilotInvitation(link.token, identity(), form()),
  ).rejects.toMatchObject({ statusCode: 409 })
  expect(
    await prisma.organizationMember.findUnique({ where: { id: existing.id } }),
  ).toEqual(existing)
  expect(await prisma.organization.count()).toBe(1)
})
it('serializes two approved links for one account without creating two workspaces', async () => {
  const first = await issue(),
    secondId = randomUUID()
  sourceIds.push(secondId)
  await prisma.waitlist.create({
    data: {
      id: secondId,
      email: 'PROSPECT@example.test',
      name: 'Synthetic second source',
    },
  })
  const second = await issue(secondId)
  const results = await Promise.allSettled([
    acceptPilotInvitation(first.token, identity(), form()),
    acceptPilotInvitation(second.token, identity(), {
      ...form(),
      slug: `${prefix}-other`,
    }),
  ])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  expect(await prisma.organization.count()).toBe(2)
})
it.each(['anon', 'authenticated'])(
  'denies %s direct credential or authority access',
  async (role) => {
    await issue()
    await expect(
      prisma.$transaction(async (db) => {
        await db.$executeRawUnsafe(`SET LOCAL ROLE ${role}`)
        return db.$queryRawUnsafe('SELECT * FROM "WaitlistPilotInvite" LIMIT 1')
      }),
    ).rejects.toThrow(/permission denied/)
  },
)
