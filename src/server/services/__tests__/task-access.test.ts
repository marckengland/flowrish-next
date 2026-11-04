import { beforeEach, expect, it, vi } from 'vitest'
import type { Session } from '@/server/auth/session'
const mocks = vi.hoisted(() => ({
  db: {
    task: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    lead: { findFirst: vi.fn(), update: vi.fn() },
    activity: { create: vi.fn() },
  },
  member: vi.fn(),
  user: vi.fn(),
  access: vi.fn(),
}))
vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: () => mocks.db,
}))
vi.mock('@/server/db/client', () => ({
  prisma: {
    organizationMember: { findUnique: mocks.member },
    user: { findUnique: mocks.user },
  },
}))
vi.mock('../access', () => ({ getLeadAccessFilter: mocks.access }))
import {
  createAuthorizedTask,
  completeAuthorizedTask,
  reassignAuthorizedTask,
  getAuthorizedTask,
  updateAuthorizedTask,
  createTaskFromProposal,
} from '../task-access'
const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  lead: '33333333-3333-4333-8333-333333333333',
  task: '44444444-4444-4444-8444-444444444444',
  org: '55555555-5555-4555-8555-555555555555',
}
const actor = (hierarchy = 3) =>
  ({
    organizationId: ids.org,
    dbUser: {
      id: ids.user,
      teamMemberships: [
        {
          role: {
            hierarchy,
            permissions: [{ key: 'leads:read' }, { key: 'leads:write' }],
          },
        },
      ],
    },
  }) as unknown as Session
const form = () => ({
  title: 'Practice task',
  dueDate: '2026-11-05T09:00:00Z',
  leadId: ids.lead,
  assigneeId: ids.user,
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.member.mockResolvedValue({ id: 'membership' })
  mocks.user.mockResolvedValue({ id: ids.user })
  mocks.access.mockResolvedValue({ deletedAt: null, assignedUserId: ids.user })
  mocks.db.lead.findFirst.mockResolvedValue({ id: ids.lead })
  mocks.db.task.create.mockResolvedValue({ id: ids.task })
  mocks.db.task.update.mockResolvedValue({ id: ids.task })
  mocks.db.task.findFirst.mockResolvedValue({
    id: ids.task,
    leadId: ids.lead,
    assigneeId: ids.user,
    title: 'Practice task',
    isComplete: false,
    dueDate: new Date('2026-11-05'),
  })
})
it('checks accessible lead and active organization membership before task creation', async () => {
  await createAuthorizedTask(actor(), form())
  expect(mocks.member).toHaveBeenCalledWith({
    where: {
      userId_organizationId: { userId: ids.user, organizationId: ids.org },
    },
    select: { id: true },
  })
  expect(mocks.db.lead.findFirst).toHaveBeenCalledWith({
    where: { deletedAt: null, assignedUserId: ids.user, id: ids.lead },
  })
  expect(mocks.db.task.create).toHaveBeenCalledTimes(1)
})
it('rejects member assignment to a colleague and managers assigning outside the organization', async () => {
  await expect(
    createAuthorizedTask(actor(), { ...form(), assigneeId: ids.other }),
  ).rejects.toMatchObject({ statusCode: 403 })
  mocks.member.mockResolvedValue(null)
  await expect(
    createAuthorizedTask(actor(2), { ...form(), assigneeId: ids.other }),
  ).rejects.toMatchObject({ statusCode: 404 })
  expect(mocks.db.task.create).not.toHaveBeenCalled()
})
it('rejects inaccessible leads without creating a task', async () => {
  mocks.db.lead.findFirst.mockResolvedValue(null)
  await expect(createAuthorizedTask(actor(), form())).rejects.toMatchObject({
    statusCode: 404,
  })
  expect(mocks.db.task.create).not.toHaveBeenCalled()
})
it('includes ownership in task detail lookup and the final completion update', async () => {
  await getAuthorizedTask(actor(), ids.task)
  expect(mocks.db.task.findFirst).toHaveBeenLastCalledWith(
    expect.objectContaining({ where: { assigneeId: ids.user, id: ids.task } }),
  )
  await completeAuthorizedTask(actor(), ids.task)
  expect(mocks.db.task.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { assigneeId: ids.user, id: ids.task } }),
  )
})
it('denies unreadable task detail/completion/edit before any mutation', async () => {
  mocks.db.task.findFirst.mockResolvedValue(null)
  await expect(getAuthorizedTask(actor(), ids.task)).rejects.toMatchObject({
    statusCode: 404,
  })
  await expect(completeAuthorizedTask(actor(), ids.task)).rejects.toMatchObject(
    { statusCode: 404 },
  )
  await expect(
    updateAuthorizedTask(actor(), ids.task, { title: 'Changed' }),
  ).rejects.toMatchObject({ statusCode: 404 })
  expect(mocks.db.task.update).not.toHaveBeenCalled()
  expect(mocks.db.activity.create).not.toHaveBeenCalled()
})
it('validates reassignment before writing and retains scoped manager updates', async () => {
  await expect(
    reassignAuthorizedTask(actor(), ids.task, ids.other),
  ).rejects.toMatchObject({ statusCode: 403 })
  mocks.member.mockResolvedValue(null)
  await expect(
    reassignAuthorizedTask(actor(2), ids.task, ids.other),
  ).rejects.toMatchObject({ statusCode: 404 })
  expect(mocks.db.task.update).not.toHaveBeenCalled()
  mocks.member.mockResolvedValue({ id: 'membership' })
  await reassignAuthorizedTask(actor(2), ids.task, ids.other)
  expect(mocks.db.task.update).toHaveBeenCalledWith({
    where: { id: ids.task },
    data: { assigneeId: ids.other },
  })
})
it('validates all edit fields before reassigning or updating', async () => {
  await expect(
    updateAuthorizedTask(actor(2), ids.task, {
      assigneeId: ids.other,
      title: '',
      priority: 'HIGH',
    }),
  ).rejects.toBeDefined()
  expect(mocks.db.task.update).not.toHaveBeenCalled()
  await updateAuthorizedTask(actor(), ids.task, {
    title: 'Reviewed task',
    priority: 'HIGH',
    assigneeId: ids.user,
  })
  expect(mocks.db.task.update).toHaveBeenCalledWith({
    where: { assigneeId: ids.user, id: ids.task },
    data: { title: 'Reviewed task', priority: 'HIGH', assigneeId: ids.user },
  })
})

it('chooses only an accessible recent lead for a task proposal with no lead supplied', async () => {
  await createTaskFromProposal(actor(), { title: 'Practice reminder' })
  expect(mocks.db.lead.findFirst).toHaveBeenNthCalledWith(1, {
    where: { deletedAt: null, assignedUserId: ids.user },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  expect(mocks.db.task.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ assigneeId: ids.user, leadId: ids.lead }),
    }),
  )
})
