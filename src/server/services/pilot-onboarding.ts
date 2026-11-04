import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import type { Waitlist, WaitlistPilotInvite } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import {
  assertWaitlistStaff,
  lockWaitlistStaff,
  type WaitlistDb,
} from '@/server/auth/waitlist-staff'
import { createOrganization } from '@/server/services/organizations'
import { AppError } from '@/lib/errors'
import { siteConfig } from '@/lib/site'
import { waitlistEntrySchema } from '@/lib/staff-waitlist'
import {
  PILOT_DAYS,
  pilotTokenSchema,
  pilotPreviewInputSchema,
  pilotIssueSchema,
  pilotRevokeSchema,
  pilotAcceptSchema,
  type PilotStatus,
} from '@/lib/pilot-onboarding'

export interface PilotIdentity {
  userId: string
  email: string
  verified: boolean
}
const uuid = z.string().uuid()
const conflict = () =>
  new AppError(
    'PILOT_CONFLICT',
    'Invitation details changed. Reload and review again.',
    409,
  )
const unavailable = () =>
  new AppError(
    'PILOT_UNAVAILABLE',
    'This invitation is unavailable for this account. Reopen your private link or contact Flowrish.',
    403,
  )
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const normalize = (email: string) => email.trim().toLowerCase()
const entryView = (row: Waitlist) =>
  waitlistEntrySchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
function invitationView(row: WaitlistPilotInvite | null) {
  if (!row) return null
  return {
    generation: row.generation,
    email: row.email,
    state: row.acceptedAt
      ? ('joined' as const)
      : row.revokedAt
        ? ('revoked' as const)
        : row.expiresAt.getTime() <= Date.now()
          ? ('expired' as const)
          : ('active' as const),
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  }
}
async function staffState(id: string, db: WaitlistDb) {
  const [source, invitation] = await Promise.all([
    db.waitlist.findUnique({ where: { id } }),
    db.waitlistPilotInvite.findUnique({ where: { waitlistId: id } }),
  ])
  if (!source)
    throw new AppError('NOT_FOUND', 'Waitlist signup not found.', 404)
  return {
    source,
    invitation,
    data: { entry: entryView(source), invitation: invitationView(invitation) },
  }
}
function previewOf(
  organizationId: string,
  userId: string,
  state: Awaited<ReturnType<typeof staffState>>,
  expectedVersion: number,
) {
  if (
    state.source.reviewVersion !== expectedVersion ||
    state.source.status === 'joined' ||
    state.invitation?.acceptedAt ||
    state.data.invitation?.state === 'active'
  )
    throw conflict()
  return {
    version: digest(
      JSON.stringify({
        organizationId,
        userId,
        data: state.data,
        expiresInDays: PILOT_DAYS,
      }),
    ),
    email: normalize(state.source.email),
    expiresInDays: PILOT_DAYS,
  }
}
async function lockSource(
  organizationId: string,
  userId: string,
  id: string,
  db: WaitlistDb,
) {
  await lockWaitlistStaff(organizationId, userId, db)
  const rows = await db.$queryRaw<
    { id: string }[]
  >`SELECT id FROM "Waitlist" WHERE id=${id} FOR UPDATE`
  if (!rows.length)
    throw new AppError('NOT_FOUND', 'Waitlist signup not found.', 404)
  await db.$queryRaw`SELECT id FROM "WaitlistPilotInvite" WHERE "waitlistId"=${id} FOR UPDATE`
}
export async function getPilotInvitation(
  organizationId: string,
  userId: string,
  id: string,
) {
  await assertWaitlistStaff(organizationId, userId)
  uuid.parse(id)
  return prisma.$transaction(async (db) => (await staffState(id, db)).data, {
    isolationLevel: 'RepeatableRead',
  })
}
export async function previewPilotInvitation(
  organizationId: string,
  userId: string,
  id: string,
  raw: unknown,
) {
  await assertWaitlistStaff(organizationId, userId)
  uuid.parse(id)
  const input = pilotPreviewInputSchema.parse(raw)
  return prisma.$transaction(
    async (db) =>
      previewOf(
        organizationId,
        userId,
        await staffState(id, db),
        input.expectedVersion,
      ),
    { isolationLevel: 'RepeatableRead' },
  )
}
export async function issuePilotInvitation(
  organizationId: string,
  userId: string,
  id: string,
  raw: unknown,
) {
  await assertWaitlistStaff(organizationId, userId)
  uuid.parse(id)
  const input = pilotIssueSchema.parse(raw)
  return prisma.$transaction(async (db) => {
    await lockSource(organizationId, userId, id, db)
    const state = await staffState(id, db)
    if (state.invitation?.issueRequestId === input.requestId)
      return { ...state.data, link: null }
    if (
      previewOf(organizationId, userId, state, input.expectedVersion)
        .version !== input.previewVersion
    )
      throw conflict()
    const token = randomBytes(32).toString('hex'),
      issuedAt = new Date(),
      expiresAt = new Date(issuedAt.getTime() + PILOT_DAYS * 86400000)
    const data = {
      email: normalize(state.source.email),
      tokenHash: digest(token),
      issueRequestId: input.requestId,
      generation: (state.invitation?.generation ?? 0) + 1,
      issuedById: userId,
      issuedByOrganizationId: organizationId,
      issuedAt,
      expiresAt,
      revokedAt: null,
    }
    const row = await db.waitlistPilotInvite.upsert({
      where: { waitlistId: id },
      create: { waitlistId: id, ...data },
      update: data,
    })
    const changed = await db.waitlist.updateMany({
      where: { id, reviewVersion: input.expectedVersion },
      data: { status: 'invited', reviewVersion: { increment: 1 } },
    })
    if (changed.count !== 1) throw conflict()
    const source = await db.waitlist.findUnique({ where: { id } })
    const link = new URL('/pilot', siteConfig.url)
    link.hash = `invite=${token}`
    return {
      entry: entryView(source!),
      invitation: invitationView(row),
      link: link.toString(),
    }
  })
}
export async function revokePilotInvitation(
  organizationId: string,
  userId: string,
  id: string,
  raw: unknown,
) {
  await assertWaitlistStaff(organizationId, userId)
  uuid.parse(id)
  const input = pilotRevokeSchema.parse(raw)
  return prisma.$transaction(async (db) => {
    await lockSource(organizationId, userId, id, db)
    const state = await staffState(id, db),
      row = state.invitation
    if (
      !row ||
      row.generation !== input.generation ||
      row.acceptedAt ||
      state.source.status === 'joined'
    )
      throw conflict()
    if (row.revokedAt) return state.data
    if (state.source.reviewVersion !== input.expectedVersion) throw conflict()
    await db.waitlistPilotInvite.update({
      where: { waitlistId: id },
      data: { revokedAt: new Date() },
    })
    const changed = await db.waitlist.updateMany({
      where: { id, reviewVersion: input.expectedVersion },
      data: { status: 'pending', reviewVersion: { increment: 1 } },
    })
    if (changed.count !== 1) throw conflict()
    return (await staffState(id, db)).data
  })
}
function matches(
  row: WaitlistPilotInvite | null,
  identity: PilotIdentity | null,
): row is WaitlistPilotInvite {
  return Boolean(
    row && identity?.verified && normalize(identity.email) === row.email,
  )
}
async function joined(
  row: WaitlistPilotInvite,
  identity: PilotIdentity,
  db: WaitlistDb,
): Promise<PilotStatus> {
  if (row.acceptedById !== identity.userId || !row.organizationId)
    return { state: 'unavailable' }
  const [membership, organization] = await Promise.all([
    db.organizationMember.findUnique({
      where: {
        userId_organizationId: {
          userId: identity.userId,
          organizationId: row.organizationId,
        },
      },
    }),
    db.organization.findUnique({
      where: { id: row.organizationId },
      select: { name: true },
    }),
  ])
  if (!membership || !organization) return { state: 'unavailable' }
  const others = await db.organizationMember.findMany({
    where: {
      userId: identity.userId,
      organizationId: { not: row.organizationId },
    },
    select: { organizationId: true, isDefault: true },
  })
  const canContinue = membership.isDefault
    ? !others.some((member) => member.isDefault)
    : others.length === 0
  return {
    state: 'joined',
    organizationName: organization.name,
    continueHref: canContinue ? '/receptionist/setup' : null,
  }
}
function active(row: WaitlistPilotInvite) {
  return !row.revokedAt && row.expiresAt.getTime() > Date.now()
}
export async function getPilotStatus(
  token: string | null,
  identity: PilotIdentity | null,
): Promise<PilotStatus> {
  if (!token || !pilotTokenSchema.safeParse(token).success)
    return { state: 'missing' }
  if (!identity?.verified) return { state: 'sign_in' }
  const row = await prisma.waitlistPilotInvite.findUnique({
    where: { tokenHash: digest(token) },
  })
  if (!matches(row, identity)) return { state: 'unavailable' }
  if (row.acceptedAt) return joined(row, identity, prisma)
  if (!active(row)) return { state: 'unavailable' }
  const source = await prisma.waitlist.findUnique({
    where: { id: row.waitlistId },
  })
  if (
    !source ||
    normalize(source.email) !== row.email ||
    source.status === 'joined'
  )
    return { state: 'unavailable' }
  if (
    await prisma.organizationMember.count({
      where: { userId: identity.userId },
    })
  )
    return { state: 'existing_workspace' }
  return { state: 'ready', expiresAt: row.expiresAt.toISOString() }
}
export async function acceptPilotInvitation(
  token: string,
  identity: PilotIdentity | null,
  raw: unknown,
): Promise<PilotStatus> {
  if (!identity?.verified || !pilotTokenSchema.safeParse(token).success)
    throw unavailable()
  const input = pilotAcceptSchema.parse(raw),
    tokenHash = digest(token)
  return prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT id FROM "User" WHERE id=${identity.userId} FOR UPDATE`
      const initial = await db.waitlistPilotInvite.findUnique({
        where: { tokenHash },
      })
      if (!matches(initial, identity)) throw unavailable()
      await db.$queryRaw`SELECT id FROM "Waitlist" WHERE id=${initial.waitlistId} FOR UPDATE`
      await db.$queryRaw`SELECT id FROM "WaitlistPilotInvite" WHERE "waitlistId"=${initial.waitlistId} FOR UPDATE`
      const row = await db.waitlistPilotInvite.findUnique({
        where: { tokenHash },
      })
      if (!matches(row, identity)) throw unavailable()
      if (row.acceptedAt) {
        const receipt = await joined(row, identity, db)
        if (receipt.state !== 'joined') throw unavailable()
        return receipt
      }
      if (!active(row)) throw unavailable()
      const source = await db.waitlist.findUnique({
        where: { id: row.waitlistId },
      })
      if (
        !source ||
        normalize(source.email) !== row.email ||
        source.status === 'joined'
      )
        throw unavailable()
      if (
        await db.organizationMember.count({
          where: { userId: identity.userId },
        })
      )
        throw new AppError(
          'PILOT_EXISTING_WORKSPACE',
          'This account already belongs to a workspace. Contact Flowrish before creating another.',
          409,
        )
      const { organization } = await createOrganization(
        input.name,
        input.slug,
        identity.userId,
        db,
      )
      const accepted = await db.waitlistPilotInvite.update({
        where: { waitlistId: row.waitlistId },
        data: {
          acceptedAt: new Date(),
          acceptedById: identity.userId,
          organizationId: organization.id,
        },
      })
      await db.waitlist.updateMany({
        where: { id: row.waitlistId },
        data: { status: 'joined', reviewVersion: { increment: 1 } },
      })
      return joined(accepted, identity, db)
    },
    { timeout: 15000 },
  )
}
