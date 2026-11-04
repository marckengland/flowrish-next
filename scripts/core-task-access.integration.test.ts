import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import type { Session } from '@/server/auth/session'
const race = vi.hoisted(() => ({ enabled: false, taskId: '', newAssignee: '' }))
vi.mock('@/server/db/client', async () => {
  const raw = process.env.CORE_TEST_DATABASE_URL
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
vi.mock('@/server/db/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/server/db/middleware')>(
    '@/server/db/middleware',
  )
  return {
    ...actual,
    createTenantPrisma: (orgId: string) => {
      const db = actual.createTenantPrisma(orgId)
      return db.$extends({
        query: {
          task: {
            async findFirst({ args, query }) {
              const task = await query(args)
              if (race.enabled && task?.id === race.taskId) {
                race.enabled = false
                await db.task.update({
                  where: { id: task.id },
                  data: { assigneeId: race.newAssignee },
                })
              }
              return task
            },
          },
        },
      })
    },
  }
})
import { prisma } from '@/server/db/client'
import {
  createAuthorizedTask,
  completeAuthorizedTask,
  getAuthorizedTask,
  getAuthorizedTasks,
  reassignAuthorizedTask,
  updateAuthorizedTask,
} from '@/server/services/task-access'
const org = randomUUID(),
  foreignOrg = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  other = randomUUID(),
  foreignUser = randomUUID(),
  pipeline = randomUUID(),
  stage = randomUUID(),
  ownLead = randomUUID(),
  otherLead = randomUUID(),
  ownTask = randomUUID(),
  otherTask = randomUUID(),
  prefix = `mock-core-${randomUUID()}`
function actor(userId = member, hierarchy = 3): Session {
  return {
    organizationId: org,
    dbUser: {
      id: userId,
      teamMemberships: [
        {
          role: {
            hierarchy,
            permissions: [{ key: 'leads:read' }, { key: 'leads:write' }],
          },
        },
      ],
    },
  } as unknown as Session
}
beforeAll(async () => {
  await prisma.organization.createMany({
    data: [
      { id: org, name: 'Synthetic core', slug: `${prefix}-core` },
      { id: foreignOrg, name: 'Synthetic foreign', slug: `${prefix}-foreign` },
    ],
  })
  await prisma.user.createMany({
    data: [owner, member, other, foreignUser].map((id) => ({
      id,
      authId: randomUUID(),
      email: `${id}@example.test`,
      name: 'Synthetic user',
    })),
  })
  await prisma.organizationMember.createMany({
    data: [owner, member, other]
      .map((userId) => ({ userId, organizationId: org, isDefault: true }))
      .concat([
        { userId: foreignUser, organizationId: foreignOrg, isDefault: true },
      ]),
  })
  await prisma.pipeline.create({
    data: { id: pipeline, organizationId: org, name: 'Synthetic pipeline' },
  })
  await prisma.stage.create({
    data: { id: stage, pipelineId: pipeline, name: 'New', order: 1 },
  })
  await prisma.lead.createMany({
    data: [
      {
        id: ownLead,
        organizationId: org,
        stageId: stage,
        firstName: 'Synthetic',
        lastName: 'Own',
        assignedUserId: member,
      },
      {
        id: otherLead,
        organizationId: org,
        stageId: stage,
        firstName: 'Synthetic',
        lastName: 'Other',
        assignedUserId: other,
      },
    ],
  })
  await prisma.task.createMany({
    data: [
      {
        id: ownTask,
        organizationId: org,
        leadId: ownLead,
        assigneeId: member,
        title: 'Synthetic own',
        dueDate: new Date('2026-11-05'),
      },
      {
        id: otherTask,
        organizationId: org,
        leadId: otherLead,
        assigneeId: other,
        title: 'Synthetic other',
        dueDate: new Date('2026-11-05'),
      },
    ],
  })
})
afterAll(async () => {
  await prisma.activity.deleteMany({ where: { organizationId: org } })
  await prisma.task.deleteMany({ where: { organizationId: org } })
  await prisma.lead.deleteMany({ where: { organizationId: org } })
  await prisma.stage.deleteMany({ where: { pipelineId: pipeline } })
  await prisma.pipeline.deleteMany({ where: { organizationId: org } })
  await prisma.organizationMember.deleteMany({
    where: { organizationId: { in: [org, foreignOrg] } },
  })
  await prisma.organization.deleteMany({
    where: { id: { in: [org, foreignOrg] } },
  })
  await prisma.user.deleteMany({
    where: { id: { in: [owner, member, other, foreignUser] } },
  })
  await prisma.$disconnect()
})
it('keeps real task list/detail/complete/edit reads scoped even with forged filters or ids', async () => {
  const tasks = await getAuthorizedTasks(actor(), { assigneeId: other })
  expect(tasks.map((row) => row.id)).toEqual([ownTask])
  await expect(getAuthorizedTask(actor(), otherTask)).rejects.toMatchObject({
    statusCode: 404,
  })
  await expect(
    completeAuthorizedTask(actor(), otherTask),
  ).rejects.toMatchObject({ statusCode: 404 })
  await expect(
    updateAuthorizedTask(actor(), otherTask, { title: 'Forbidden edit' }),
  ).rejects.toMatchObject({ statusCode: 404 })
  expect(await prisma.activity.count()).toBe(0)
  expect(
    await prisma.task.findUnique({ where: { id: otherTask } }),
  ).toMatchObject({
    title: 'Synthetic other',
    isComplete: false,
    assigneeId: other,
  })
})
it('rejects inaccessible leads, member colleague assignments and foreign assignees without writes', async () => {
  const form = {
    title: 'Synthetic task',
    leadId: ownLead,
    assigneeId: member,
    dueDate: new Date('2026-11-05'),
  }
  await expect(
    createAuthorizedTask(actor(), { ...form, leadId: otherLead }),
  ).rejects.toMatchObject({ statusCode: 404 })
  await expect(
    createAuthorizedTask(actor(), { ...form, assigneeId: other }),
  ).rejects.toMatchObject({ statusCode: 403 })
  await expect(
    createAuthorizedTask(actor(owner, 0), { ...form, assigneeId: foreignUser }),
  ).rejects.toMatchObject({ statusCode: 404 })
  await expect(
    reassignAuthorizedTask(actor(owner, 0), ownTask, foreignUser),
  ).rejects.toMatchObject({ statusCode: 404 })
  expect(await prisma.task.count()).toBe(2)
})
it('validates before an atomic edit and preserves valid manager reassignment', async () => {
  await expect(
    updateAuthorizedTask(actor(owner, 0), otherTask, {
      title: '',
      assigneeId: member,
    }),
  ).rejects.toBeDefined()
  expect(
    await prisma.task.findUnique({ where: { id: otherTask } }),
  ).toMatchObject({ assigneeId: other })
  await reassignAuthorizedTask(actor(owner, 0), otherTask, member)
  expect(
    await prisma.task.findUnique({ where: { id: otherTask } }),
  ).toMatchObject({ assigneeId: member })
  await reassignAuthorizedTask(actor(owner, 0), otherTask, other)
})
it('fails closed if ownership changes after the read but before the final completion update', async () => {
  race.taskId = ownTask
  race.newAssignee = other
  race.enabled = true
  await expect(completeAuthorizedTask(actor(), ownTask)).rejects.toBeDefined()
  expect(race.enabled).toBe(false)
  expect(
    await prisma.task.findUnique({ where: { id: ownTask } }),
  ).toMatchObject({ assigneeId: other, isComplete: false })
  expect(await prisma.activity.count()).toBe(0)
  expect(await prisma.aiUsageDay.count()).toBe(0)
})

it('creates and completes an authorized task with one activity and no provider usage', async () => {
  const created = await createAuthorizedTask(actor(), {
    title: 'Authorized synthetic task',
    leadId: ownLead,
    assigneeId: member,
    dueDate: new Date('2026-11-05'),
  })
  expect(created).toMatchObject({
    organizationId: org,
    assigneeId: member,
    leadId: ownLead,
    isComplete: false,
  })
  const complete = await completeAuthorizedTask(actor(), created.id)
  expect(complete).toMatchObject({
    isComplete: true,
    completedAt: expect.any(Date),
  })
  expect(
    await prisma.activity.count({
      where: { leadId: ownLead, createdById: member },
    }),
  ).toBe(1)
  expect(await prisma.aiUsageDay.count()).toBe(0)
})
