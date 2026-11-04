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
  const raw = process.env.WAITLIST_TEST_DATABASE_URL
  if (!raw)
    throw new Error('An explicit disposable local database URL is required.')
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
  listStaffWaitlist,
  updateStaffWaitlist,
  getWaitlistHandoffOptions,
  previewWaitlistHandoff,
  commitWaitlistHandoff,
} from '@/server/services/staff-waitlist'

const org = randomUUID(),
  otherOrg = randomUUID(),
  user = randomUUID(),
  otherUser = randomUUID(),
  membership = randomUUID(),
  otherMembership = randomUUID(),
  role = randomUUID(),
  team = randomUUID(),
  pipeline = randomUUID(),
  stage = randomUUID()
const entryIds: string[] = []
let id: string
const draft = () => ({
  expectedVersion: 0,
  target: {
    mode: 'new' as const,
    firstName: 'Jamie',
    lastName: 'Example',
    stageId: stage,
    assigneeId: user,
    acknowledgeDuplicate: false,
  },
})
const commit = (input: ReturnType<typeof draft>, version: string) =>
  commitWaitlistHandoff(org, user, id, {
    draft: input,
    previewVersion: version,
    confirmed: true,
  })

beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { id: org, name: 'Synthetic Flowrish', slug: `mock-${org}` },
      {
        id: otherOrg,
        name: 'Synthetic other organization',
        slug: `mock-${otherOrg}`,
      },
    ],
  })
  await prisma.user.createMany({
    data: [
      {
        id: user,
        authId: randomUUID(),
        email: `${user}@example.test`,
        name: 'Synthetic staff',
      },
      {
        id: otherUser,
        authId: randomUUID(),
        email: `${otherUser}@example.test`,
        name: 'Synthetic outsider',
      },
    ],
  })
  await prisma.organizationMember.createMany({
    data: [
      { id: membership, organizationId: org, userId: user },
      { id: otherMembership, organizationId: otherOrg, userId: otherUser },
    ],
  })
  await prisma.role.create({
    data: {
      id: role,
      name: 'Synthetic CRM staff',
      organizationId: org,
      hierarchy: 3,
      permissions: { create: [{ key: 'leads:read' }, { key: 'leads:write' }] },
    },
  })
  await prisma.team.create({
    data: { id: team, name: 'Synthetic staff', organizationId: org },
  })
  await prisma.teamMember.create({
    data: { userId: user, roleId: role, teamId: team },
  })
  await prisma.pipeline.create({
    data: { id: pipeline, name: 'Synthetic sales', organizationId: org },
  })
  await prisma.stage.create({
    data: { id: stage, name: 'Synthetic open', order: 1, pipelineId: pipeline },
  })
})
beforeEach(async () => {
  await prisma.waitlistStaffAccess.upsert({
    where: { membershipId: membership },
    create: { membershipId: membership },
    update: {},
  })
  id = randomUUID()
  entryIds.push(id)
  await prisma.waitlist.create({
    data: {
      id,
      email: `${id}@example.test`,
      name: 'Jamie Example',
      source: 'public_demo',
    },
  })
})
afterEach(async () => {
  await prisma.waitlistCrmHandoff.deleteMany({ where: { organizationId: org } })
  await prisma.lead.deleteMany({ where: { organizationId: org } })
  await prisma.waitlist.deleteMany({ where: { id: { in: entryIds } } })
  await prisma.stage.update({
    where: { id: stage },
    data: { isClosedWon: false },
  })
})
afterAll(async () => {
  await prisma.teamMember.deleteMany({ where: { teamId: team } })
  await prisma.team.deleteMany({ where: { id: team } })
  await prisma.role.deleteMany({ where: { id: role } })
  await prisma.organizationMember.deleteMany({
    where: { id: { in: [membership, otherMembership] } },
  })
  await prisma.stage.deleteMany({ where: { id: stage } })
  await prisma.pipeline.deleteMany({ where: { id: pipeline } })
  await prisma.user.deleteMany({ where: { id: { in: [user, otherUser] } } })
  await prisma.organization.deleteMany({
    where: { id: { in: [org, otherOrg] } },
  })
  await prisma.$disconnect()
})

it('grants only the exact live membership, with repeatable grant rollback and no cross-org escalation', async () => {
  await assertWaitlistStaff(org, user)
  await expect(assertWaitlistStaff(otherOrg, user)).rejects.toMatchObject({
    statusCode: 403,
  })
  await expect(
    listStaffWaitlist(otherOrg, otherUser, {}),
  ).rejects.toMatchObject({ statusCode: 403 })
  await prisma.waitlistStaffAccess.deleteMany({
    where: { membershipId: membership },
  })
  await prisma.waitlistStaffAccess.deleteMany({
    where: { membershipId: membership },
  })
  await expect(assertWaitlistStaff(org, user)).rejects.toMatchObject({
    statusCode: 403,
  })
  expect(
    await prisma.organizationMember.count({ where: { id: otherMembership } }),
  ).toBe(1)
  await prisma.waitlistStaffAccess.create({
    data: { membershipId: membership },
  })
  await assertWaitlistStaff(org, user)
})
it('permits exactly one concurrent review update while preserving signup status', async () => {
  const results = await Promise.allSettled([
    updateStaffWaitlist(org, user, id, {
      reviewStatus: 'reviewed',
      expectedVersion: 0,
    }),
    updateStaffWaitlist(org, user, id, {
      reviewStatus: 'contacted',
      expectedVersion: 0,
    }),
  ])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1)
  expect(await prisma.waitlist.findUnique({ where: { id } })).toMatchObject({
    status: 'pending',
    reviewVersion: 1,
  })
})
it('commits only one lead and receipt under concurrent confirmation and preserves retries after lead deletion', async () => {
  const input = draft(),
    preview = await previewWaitlistHandoff(org, user, id, input)
  const results = await Promise.all([
    commit(input, preview.version),
    commit(input, preview.version),
  ])
  expect(results[0].leadId).toBe(results[1].leadId)
  expect(await prisma.lead.count({ where: { organizationId: org } })).toBe(1)
  expect(
    await prisma.waitlistCrmHandoff.count({ where: { waitlistId: id } }),
  ).toBe(1)
  expect(await prisma.waitlist.findUnique({ where: { id } })).toMatchObject({
    status: 'pending',
    reviewStatus: 'reviewed',
    reviewVersion: 1,
  })
  await prisma.lead.delete({ where: { id: results[0].leadId } })
  expect(await commit(input, preview.version)).toMatchObject({
    leadId: results[0].leadId,
    leadAvailable: false,
  })
  expect(await prisma.lead.count({ where: { organizationId: org } })).toBe(0)
})
it('matches duplicate email case-insensitively and links only the explicitly chosen lead without editing it', async () => {
  const source = await prisma.waitlist.findUniqueOrThrow({ where: { id } })
  const leads = await Promise.all(
    ['First', 'Second'].map((firstName) =>
      prisma.lead.create({
        data: {
          organizationId: org,
          firstName,
          lastName: 'Example',
          email: source.email.toUpperCase(),
          stageId: stage,
          assignedUserId: user,
        },
      }),
    ),
  )
  const options = await getWaitlistHandoffOptions(org, user, id)
  expect(options.leads).toHaveLength(2)
  await expect(
    previewWaitlistHandoff(org, user, id, draft()),
  ).rejects.toMatchObject({ statusCode: 409 })
  const input = {
    expectedVersion: 0,
    target: { mode: 'existing' as const, leadId: leads[1].id },
  }
  const preview = await previewWaitlistHandoff(org, user, id, input)
  await commitWaitlistHandoff(org, user, id, {
    draft: input,
    previewVersion: preview.version,
    confirmed: true,
  })
  expect(await prisma.lead.findUnique({ where: { id: leads[1].id } })).toEqual(
    leads[1],
  )
  expect(await prisma.lead.count({ where: { organizationId: org } })).toBe(2)
})
it('rolls back the lead when writing its receipt fails', async () => {
  const input = draft(),
    preview = await previewWaitlistHandoff(org, user, id, input)
  // Test-generated UUID, on a loopback-only disposable database.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "WaitlistCrmHandoff" ADD CONSTRAINT mock_receipt_failure CHECK ("waitlistId" <> '${id}')`,
  )
  try {
    await expect(commit(input, preview.version)).rejects.toBeDefined()
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "WaitlistCrmHandoff" DROP CONSTRAINT mock_receipt_failure',
    )
  }
  expect(await prisma.lead.count({ where: { organizationId: org } })).toBe(0)
  expect(
    await prisma.waitlistCrmHandoff.count({ where: { waitlistId: id } }),
  ).toBe(0)
  expect(await prisma.waitlist.findUnique({ where: { id } })).toMatchObject({
    reviewVersion: 0,
  })
})
it('rejects source changes and closed destinations after preview without creating a lead', async () => {
  const input = draft(),
    preview = await previewWaitlistHandoff(org, user, id, input)
  await updateStaffWaitlist(org, user, id, {
    reviewStatus: 'reviewed',
    expectedVersion: 0,
  })
  await expect(commit(input, preview.version)).rejects.toMatchObject({
    statusCode: 409,
  })
  input.expectedVersion = 1
  const fresh = await previewWaitlistHandoff(org, user, id, input)
  await prisma.stage.update({
    where: { id: stage },
    data: { isClosedWon: true },
  })
  await expect(commit(input, fresh.version)).rejects.toMatchObject({
    statusCode: 409,
  })
  expect(await prisma.lead.count({ where: { organizationId: org } })).toBe(0)
})
it('rejects a revoked grant and a foreign owner at the database boundary', async () => {
  const input = draft(),
    preview = await previewWaitlistHandoff(org, user, id, input)
  await expect(
    previewWaitlistHandoff(org, user, id, {
      ...input,
      target: { ...input.target, assigneeId: otherUser },
    }),
  ).rejects.toMatchObject({ statusCode: 409 })
  await prisma.waitlistStaffAccess.delete({
    where: { membershipId: membership },
  })
  await expect(commit(input, preview.version)).rejects.toMatchObject({
    statusCode: 403,
  })
  expect(await prisma.lead.count({ where: { organizationId: org } })).toBe(0)
})
it.each(['anon', 'authenticated'])(
  'denies %s direct access to prospects, grants, and receipts',
  async (roleName) => {
    for (const table of [
      'Waitlist',
      'WaitlistStaffAccess',
      'WaitlistCrmHandoff',
    ]) {
      await expect(
        prisma.$transaction(async (db) => {
          await db.$executeRawUnsafe(`SET LOCAL ROLE ${roleName}`)
          return db.$queryRawUnsafe(`SELECT * FROM "${table}" LIMIT 1`)
        }),
      ).rejects.toThrow(/permission denied/)
    }
  },
)
it('retains a valid Library GIN index and private RLS on the new tables', async () => {
  const index = await prisma.$queryRaw<
    { indisvalid: boolean }[]
  >`SELECT indisvalid FROM pg_index WHERE indexrelid='"KnowledgeChunk_searchVector_idx"'::regclass`
  expect(index[0].indisvalid).toBe(true)
  const tables = await prisma.$queryRaw<
    { relrowsecurity: boolean }[]
  >`SELECT relrowsecurity FROM pg_class WHERE relname IN ('Waitlist','WaitlistStaffAccess','WaitlistCrmHandoff') AND relnamespace='public'::regnamespace`
  expect(tables).toHaveLength(3)
  expect(tables.every((row) => row.relrowsecurity)).toBe(true)
})

it('preserves the deduplication receipt when its destination organization is retired', async () => {
  const retiredOrg = randomUUID(),
    retiredPipeline = randomUUID(),
    retiredStage = randomUUID(),
    retiredLead = randomUUID(),
    retiredSource = randomUUID()
  await prisma.organization.create({
    data: {
      id: retiredOrg,
      name: 'Synthetic retired org',
      slug: `mock-${retiredOrg}`,
    },
  })
  try {
    await prisma.pipeline.create({
      data: {
        id: retiredPipeline,
        name: 'Synthetic pipeline',
        organizationId: retiredOrg,
      },
    })
    await prisma.stage.create({
      data: {
        id: retiredStage,
        name: 'Synthetic stage',
        order: 1,
        pipelineId: retiredPipeline,
      },
    })
    await prisma.lead.create({
      data: {
        id: retiredLead,
        firstName: 'Synthetic',
        lastName: 'Retired',
        organizationId: retiredOrg,
        stageId: retiredStage,
      },
    })
    await prisma.waitlistCrmHandoff.create({
      data: {
        waitlistId: retiredSource,
        organizationId: retiredOrg,
        leadId: retiredLead,
        createdById: user,
        createdLead: true,
      },
    })
    await prisma.lead.delete({ where: { id: retiredLead } })
    await prisma.stage.delete({ where: { id: retiredStage } })
    await prisma.pipeline.delete({ where: { id: retiredPipeline } })
    await expect(
      prisma.organization.delete({ where: { id: retiredOrg } }),
    ).rejects.toMatchObject({ code: 'P2003' })
    expect(
      await prisma.waitlistCrmHandoff.count({
        where: { waitlistId: retiredSource },
      }),
    ).toBe(1)
  } finally {
    await prisma.waitlistCrmHandoff.deleteMany({
      where: { waitlistId: retiredSource },
    })
    await prisma.organization.deleteMany({ where: { id: retiredOrg } })
  }
})
