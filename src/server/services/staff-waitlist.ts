import 'server-only'
import { createHash } from 'node:crypto'
import type { Waitlist, WaitlistCrmHandoff } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import {
  assertWaitlistStaff,
  lockWaitlistStaff,
  type WaitlistDb,
} from '@/server/auth/waitlist-staff'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'
import {
  waitlistEntrySchema,
  waitlistQuerySchema,
  waitlistReviewSchema,
  waitlistHandoffDraftSchema,
  waitlistHandoffCommitSchema,
  waitlistOptionsSchema,
  waitlistPreviewSchema,
  type WaitlistDraft,
} from '@/lib/staff-waitlist'

const uuid = z.string().uuid()
const conflict = () =>
  new AppError(
    'WAITLIST_CONFLICT',
    'The signup or destination changed. Reload it and review a fresh preview.',
    409,
  )
const activeLead = { deletedAt: null, isClosed: false }
const entryView = (row: Waitlist) =>
  waitlistEntrySchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })

async function authorizeCrm(
  organizationId: string,
  userId: string,
  db: WaitlistDb = prisma,
) {
  await assertWaitlistStaff(organizationId, userId, db)
  const permissions = await getEffectivePermissions(userId, organizationId)
  if (!permissions.has('leads:read') || !permissions.has('leads:write'))
    throw new AppError(
      'FORBIDDEN',
      'CRM read and write permissions are required for handoff.',
      403,
    )
}

export async function listStaffWaitlist(
  organizationId: string,
  userId: string,
  raw: unknown,
) {
  await assertWaitlistStaff(organizationId, userId)
  const query = waitlistQuerySchema.parse(raw)
  const rows = await prisma.waitlist.findMany({
    where:
      query.reviewStatus === 'all' ? {} : { reviewStatus: query.reviewStatus },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (query.page - 1) * 20,
    take: 21,
  })
  const permissions = await getEffectivePermissions(userId, organizationId)
  return {
    entries: rows.slice(0, 20).map(entryView),
    page: query.page,
    hasNext: rows.length > 20,
    canHandoff: permissions.has('leads:read') && permissions.has('leads:write'),
  }
}

export async function updateStaffWaitlist(
  organizationId: string,
  userId: string,
  id: string,
  raw: unknown,
) {
  await assertWaitlistStaff(organizationId, userId)
  uuid.parse(id)
  const input = waitlistReviewSchema.parse(raw)
  return prisma.$transaction(async (db) => {
    await lockWaitlistStaff(organizationId, userId, db)
    const result = await db.waitlist.updateMany({
      where: { id, reviewVersion: input.expectedVersion },
      data: {
        reviewStatus: input.reviewStatus,
        reviewVersion: { increment: 1 },
        reviewedAt: new Date(),
        reviewedById: userId,
      },
    })
    if (result.count !== 1) throw conflict()
    return entryView(await db.waitlist.findUniqueOrThrow({ where: { id } }))
  })
}

async function receiptView(
  receipt: WaitlistCrmHandoff,
  organizationId: string,
  db: WaitlistDb,
) {
  if (receipt.organizationId !== organizationId) throw conflict()
  const lead = await db.lead.findFirst({
    where: { id: receipt.leadId, organizationId, deletedAt: null },
    select: { id: true },
  })
  return {
    leadId: receipt.leadId,
    leadAvailable: Boolean(lead),
    createdLead: receipt.createdLead,
    createdAt: receipt.createdAt.toISOString(),
  }
}

async function options(organizationId: string, id: string, db: WaitlistDb) {
  const [source, prior] = await Promise.all([
    db.waitlist.findUnique({ where: { id } }),
    db.waitlistCrmHandoff.findUnique({ where: { waitlistId: id } }),
  ])
  if (!source && !prior)
    throw new AppError('NOT_FOUND', 'Waitlist signup not found.', 404)
  const entry = source ? entryView(source) : null
  if (prior)
    return {
      data: waitlistOptionsSchema.parse({
        entry,
        receipt: await receiptView(prior, organizationId, db),
        leads: [],
        members: [],
        stages: [],
        matchesTruncated: false,
        choicesTruncated: false,
      }),
      snapshot: null,
    }
  const [leads, members, stages] = await Promise.all([
    db.lead.findMany({
      where: {
        organizationId,
        ...activeLead,
        OR: [
          { email: { equals: source!.email, mode: 'insensitive' } },
          { altEmail: { equals: source!.email, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
      take: 21,
    }),
    db.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { name: true } } },
      orderBy: { userId: 'asc' },
      take: 201,
    }),
    db.stage.findMany({
      where: {
        pipeline: { organizationId },
        isClosedWon: false,
        isClosedLost: false,
      },
      include: { pipeline: { select: { name: true, updatedAt: true } } },
      orderBy: [{ pipelineId: 'asc' }, { order: 'asc' }, { id: 'asc' }],
      take: 201,
    }),
  ])
  return {
    data: waitlistOptionsSchema.parse({
      entry,
      receipt: null,
      leads: leads
        .slice(0, 20)
        .map((row) => ({
          id: row.id,
          label: `${row.firstName} ${row.lastName} · ${row.email ?? ''}`,
        })),
      members: members
        .slice(0, 200)
        .map((row) => ({ id: row.userId, label: row.user.name })),
      stages: stages
        .slice(0, 200)
        .map((row) => ({
          id: row.id,
          label: `${row.pipeline.name} / ${row.name}`,
        })),
      matchesTruncated: leads.length > 20,
      choicesTruncated: members.length > 200 || stages.length > 200,
    }),
    snapshot: { leads, members, stages },
  }
}

export async function getWaitlistHandoffOptions(
  organizationId: string,
  userId: string,
  id: string,
) {
  await authorizeCrm(organizationId, userId)
  uuid.parse(id)
  return prisma.$transaction(
    async (db) => (await options(organizationId, id, db)).data,
    { isolationLevel: 'RepeatableRead' },
  )
}

async function preview(
  organizationId: string,
  userId: string,
  id: string,
  draft: WaitlistDraft,
  db: WaitlistDb,
) {
  const state = await options(organizationId, id, db),
    { data, snapshot } = state
  if (
    !data.entry ||
    data.receipt ||
    data.entry.reviewVersion !== draft.expectedVersion
  )
    throw conflict()
  const target = draft.target
  let targetLabel: string,
    ownerLabel: string | null = null,
    stageLabel: string | null = null
  if (target.mode === 'existing') {
    const lead = data.leads.find((row) => row.id === target.leadId)
    if (!lead) throw conflict()
    targetLabel = lead.label
  } else {
    const owner = data.members.find((row) => row.id === target.assigneeId),
      stage = data.stages.find((row) => row.id === target.stageId)
    if (
      !owner ||
      !stage ||
      (data.leads.length > 0 && !target.acknowledgeDuplicate)
    )
      throw conflict()
    targetLabel = `${target.firstName} ${target.lastName}`.trim()
    ownerLabel = owner.label
    stageLabel = stage.label
  }
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  })
  const version = createHash('sha256')
    .update(
      JSON.stringify({
        organizationId,
        userId,
        draft,
        data,
        snapshot,
        organization,
      }),
    )
    .digest('hex')
  return waitlistPreviewSchema.parse({
    version,
    organizationName: organization.name,
    email: data.entry.email,
    action: target.mode === 'new' ? 'create' : 'link',
    targetLabel,
    ownerLabel,
    stageLabel,
  })
}

export async function previewWaitlistHandoff(
  organizationId: string,
  userId: string,
  id: string,
  raw: unknown,
) {
  await authorizeCrm(organizationId, userId)
  uuid.parse(id)
  const draft = waitlistHandoffDraftSchema.parse(raw)
  return prisma.$transaction(
    (db) => preview(organizationId, userId, id, draft, db),
    { isolationLevel: 'RepeatableRead' },
  )
}

export async function commitWaitlistHandoff(
  organizationId: string,
  userId: string,
  id: string,
  raw: unknown,
) {
  await authorizeCrm(organizationId, userId)
  uuid.parse(id)
  const input = waitlistHandoffCommitSchema.parse(raw)
  return prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR NO KEY UPDATE`
      await lockWaitlistStaff(organizationId, userId, db)
      await authorizeCrm(organizationId, userId, db)
      await db.$queryRaw`SELECT id FROM "Waitlist" WHERE id=${id} FOR UPDATE`
      const prior = await db.waitlistCrmHandoff.findUnique({
        where: { waitlistId: id },
      })
      if (prior) return receiptView(prior, organizationId, db)
      const target = input.draft.target
      if (target.mode === 'existing')
        await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${target.leadId} AND "organizationId"=${organizationId} FOR SHARE`
      else {
        await db.$queryRaw`SELECT "userId" FROM "OrganizationMember" WHERE "organizationId"=${organizationId} AND "userId"=${target.assigneeId} FOR SHARE`
        await db.$queryRaw`SELECT s.id FROM "Stage" s JOIN "Pipeline" p ON p.id=s."pipelineId" WHERE s.id=${target.stageId} AND p."organizationId"=${organizationId} FOR SHARE OF s,p`
      }
      const reviewed = await preview(
        organizationId,
        userId,
        id,
        input.draft,
        db,
      )
      if (reviewed.version !== input.previewVersion) throw conflict()
      let leadId: string
      if (target.mode === 'existing') leadId = target.leadId
      else {
        const lead = await db.lead.create({
          data: {
            organizationId,
            firstName: target.firstName,
            lastName: target.lastName,
            email: reviewed.email,
            stageId: target.stageId,
            assignedUserId: target.assigneeId,
            leadStatus: 'NEW',
            description:
              'Waitlist interest approved for CRM handoff. No callback or outreach consent is implied.',
          },
        })
        leadId = lead.id
      }
      const receipt = await db.waitlistCrmHandoff.create({
        data: {
          waitlistId: id,
          organizationId,
          leadId,
          createdById: userId,
          createdLead: target.mode === 'new',
        },
      })
      const source = await db.waitlist.findUniqueOrThrow({ where: { id } })
      const changed = await db.waitlist.updateMany({
        where: { id, reviewVersion: input.draft.expectedVersion },
        data: {
          reviewStatus:
            source.reviewStatus === 'new' ? 'reviewed' : source.reviewStatus,
          reviewVersion: { increment: 1 },
          reviewedAt: new Date(),
          reviewedById: userId,
        },
      })
      if (changed.count !== 1) throw conflict()
      return receiptView(receipt, organizationId, db)
    },
    { timeout: 10000 },
  )
}
