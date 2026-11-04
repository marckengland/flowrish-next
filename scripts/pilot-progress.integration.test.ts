import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
vi.mock('@/server/db/client', async () => {
  const raw = process.env.PILOT_TEST_DATABASE_URL
  if (!raw) throw new Error('Explicit disposable database URL required.')
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
import { getPilotProgress } from '@/server/services/pilot-progress'
const staffOrg = randomUUID(),
  target = randomUUID(),
  staff = randomUUID(),
  owner = randomUUID(),
  source = randomUUID(),
  member = randomUUID(),
  report = randomUUID(),
  prefix = `mock-progress-${randomUUID()}`
const saved = new Date('2026-11-04T01:00:00Z'),
  run = new Date('2026-11-04T02:00:00Z')
const settings = {
  enabled: false,
  businessName: 'Synthetic private business',
  knowledge: 'PRIVATE MANUAL KNOWLEDGE',
  mode: 'always',
  timeZone: 'Asia/Manila',
  opensAt: '09:00',
  closesAt: '17:00',
  businessDays: [1, 2, 3, 4, 5],
  forwardTo: '',
  assigneeId: '',
  stageId: '',
}
beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { id: staffOrg, slug: `${prefix}-staff`, name: 'Synthetic staff' },
      { id: target, slug: `${prefix}-pilot`, name: 'Synthetic pilot' },
    ],
  })
  await prisma.user.createMany({
    data: [
      {
        id: staff,
        authId: randomUUID(),
        email: `${staff}@example.test`,
        name: 'Synthetic staff',
      },
      {
        id: owner,
        authId: randomUUID(),
        email: `${owner}@example.test`,
        name: 'Synthetic owner',
      },
    ],
  })
  await prisma.organizationMember.createMany({
    data: [
      { id: member, userId: staff, organizationId: staffOrg, isDefault: true },
      { userId: owner, organizationId: target, isDefault: true },
    ],
  })
  await prisma.waitlistStaffAccess.create({ data: { membershipId: member } })
  await prisma.waitlist.create({
    data: { id: source, email: `${owner}@example.test`, status: 'joined' },
  })
  await prisma.waitlistPilotInvite.create({
    data: {
      waitlistId: source,
      email: `${owner}@example.test`,
      tokenHash: 'b'.repeat(64),
      issueRequestId: randomUUID(),
      issuedById: staff,
      issuedByOrganizationId: staffOrg,
      issuedAt: saved,
      expiresAt: new Date('2026-11-11'),
      acceptedAt: saved,
      acceptedById: owner,
      organizationId: target,
    },
  })
  await prisma.receptionistConfig.create({
    data: { organizationId: target, settings, updatedAt: saved },
  })
  await prisma.websiteReceptionistConfig.create({
    data: {
      organizationId: target,
      enabled: false,
      allowedOrigins: ['https://sample.example'],
      updatedAt: saved,
    },
  })
  await prisma.aiProviderConfig.create({
    data: {
      organizationId: target,
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKeyCiphertext: 'SYNTHETIC-NOT-A-KEY',
      updatedAt: saved,
    },
  })
  await prisma.knowledgeDocument.createMany({
    data: ['SERVICES', 'PRICING', 'FAQ'].map((category) => ({
      id: randomUUID(),
      organizationId: target,
      title: 'PRIVATE TITLE',
      category,
      contentText: 'PRIVATE DRAFT',
      revision: 1,
      publishedTitle: 'PRIVATE TITLE',
      publishedCategory: category,
      publishedText: 'PRIVATE PUBLISHED TEXT',
      publishedRevision: 1,
      publishedAt: saved,
      receptionistApprovedRevision: 1,
      createdById: owner,
      updatedAt: saved,
    })),
  })
  await prisma.receptionistRehearsal.create({
    data: {
      id: report,
      organizationId: target,
      clientId: randomUUID(),
      createdById: owner,
      title: 'PRIVATE REPORT TITLE',
      notes: 'PRIVATE REVIEW NOTES',
      verdict: 'passed',
      snapshot: {
        settingsVersion: saved.toISOString(),
        finished: true,
        messages: [{ content: 'PRIVATE CONVERSATION' }],
      },
      createdAt: run,
      updatedAt: run,
    },
  })
})
afterAll(async () => {
  await prisma.waitlistPilotInvite.deleteMany({ where: { waitlistId: source } })
  await prisma.waitlist.deleteMany({ where: { id: source } })
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: [staffOrg, target] } },
  })
  await prisma.organization.deleteMany({
    where: { id: { in: [staffOrg, target] } },
  })
  await prisma.user.deleteMany({ where: { id: { in: [staff, owner] } } })
  await prisma.$disconnect()
})
const read = () => getPilotProgress(staffOrg, staff, source)
it('projects real PostgreSQL JSON rehearsal flags and safe readiness without customer content or writes', async () => {
  const before = await prisma.websiteReceptionistConfig.findUniqueOrThrow({
    where: { organizationId: target },
  })
  const result = await read()
  expect(result).toMatchObject({
    state: 'joined',
    businessSaved: true,
    knowledge: { services: true, pricing: true, faqs: true },
    aiConfigured: true,
    websiteSaved: true,
    widgetEnabled: false,
    rehearsal: 'passed',
    nextStep: 'manual_review',
  })
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE|SYNTHETIC-NOT-A-KEY|example\.test|sample\.example/,
  )
  expect(
    await prisma.websiteReceptionistConfig.findUnique({
      where: { organizationId: target },
    }),
  ).toEqual(before)
  expect(await prisma.lead.count()).toBe(0)
  expect(await prisma.aiUsageDay.count()).toBe(0)
  expect(await prisma.websiteReceptionistCallback.count()).toBe(0)
})
it('requires a new review after actual provider settings change', async () => {
  await prisma.aiProviderConfig.update({
    where: { organizationId: target },
    data: { updatedAt: new Date('2026-11-04T03:00:00Z') },
  })
  expect(await read()).toMatchObject({
    rehearsal: 'stale',
    nextStep: 'rehearsal',
  })
  await prisma.aiProviderConfig.update({
    where: { organizationId: target },
    data: { updatedAt: saved },
  })
})
it('requires another rehearsal after a previously approved FAQ is removed, even with another approved FAQ', async () => {
  const previous = await prisma.knowledgeDocument.findFirstOrThrow({
    where: { organizationId: target, category: 'FAQ' },
    select: { id: true },
  })
  await prisma.knowledgeDocument.create({
    data: {
      organizationId: target,
      title: 'PRIVATE SECOND FAQ',
      category: 'FAQ',
      contentText: 'PRIVATE DRAFT',
      publishedCategory: 'FAQ',
      publishedText: 'PRIVATE PUBLISHED',
      publishedAt: saved,
      publishedRevision: 1,
      receptionistApprovedRevision: 1,
      createdById: owner,
      updatedAt: saved,
    },
  })
  await prisma.knowledgeDocument.update({
    where: { id: previous.id },
    data: {
      receptionistApprovedRevision: null,
      updatedAt: new Date('2026-11-04T03:00:00Z'),
    },
  })
  expect(await read()).toMatchObject({
    knowledge: { services: true, pricing: true, faqs: true },
    rehearsal: 'stale',
    nextStep: 'rehearsal',
  })
})
it('ignores unapproved published revisions and revoked staff grants', async () => {
  await prisma.knowledgeDocument.updateMany({
    where: { organizationId: target, category: 'PRICING' },
    data: { receptionistApprovedRevision: null },
  })
  expect(await read()).toMatchObject({
    knowledge: { services: true, pricing: false, faqs: true },
    nextStep: 'knowledge',
  })
  await prisma.waitlistStaffAccess.delete({ where: { membershipId: member } })
  await expect(read()).rejects.toMatchObject({ statusCode: 403 })
})
