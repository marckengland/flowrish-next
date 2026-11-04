import 'server-only'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { assertWaitlistStaff } from '@/server/auth/waitlist-staff'
import { AppError } from '@/lib/errors'
import { pilotProgressSchema } from '@/lib/pilot-progress'
import { readiness } from './website-receptionist'

type SavedRehearsal = {
  verdict: string
  createdAt: Date
  updatedAt: Date
  settingsVersion: string | null
  finished: string | null
}
export async function getPilotProgress(
  staffOrganizationId: string,
  userId: string,
  waitlistId: string,
) {
  await assertWaitlistStaff(staffOrganizationId, userId)
  z.string().uuid().parse(waitlistId)
  return prisma.$transaction(
    async (db) => {
      await assertWaitlistStaff(staffOrganizationId, userId, db)
      const checkedAt = new Date().toISOString()
      const source = await db.waitlist.findUnique({
        where: { id: waitlistId },
        select: { id: true },
      })
      if (!source)
        throw new AppError('NOT_FOUND', 'Waitlist signup not found.', 404)
      const receipt = await db.waitlistPilotInvite.findUnique({
        where: { waitlistId },
        select: {
          acceptedAt: true,
          acceptedById: true,
          organizationId: true,
          expiresAt: true,
          revokedAt: true,
        },
      })
      if (!receipt?.acceptedAt)
        return pilotProgressSchema.parse({
          state: 'not_joined',
          invitation: !receipt
            ? 'not_issued'
            : receipt.revokedAt
              ? 'revoked'
              : receipt.expiresAt.getTime() <= Date.now()
                ? 'expired'
                : 'active',
          checkedAt,
        })
      if (!receipt.organizationId || !receipt.acceptedById)
        return pilotProgressSchema.parse({ state: 'unavailable', checkedAt })
      const organizationId = receipt.organizationId
      const owner = await db.organizationMember.findUnique({
        where: {
          userId_organizationId: {
            userId: receipt.acceptedById,
            organizationId,
          },
        },
        select: { id: true },
      })
      if (!owner)
        return pilotProgressSchema.parse({ state: 'unavailable', checkedAt })
      const [
        ready,
        business,
        website,
        provider,
        documents,
        reports,
        knowledgeChanges,
      ] = await Promise.all([
        readiness(organizationId, db),
        db.receptionistConfig.findUnique({
          where: { organizationId },
          select: { updatedAt: true },
        }),
        db.websiteReceptionistConfig.findUnique({
          where: { organizationId },
          select: { enabled: true, allowedOrigins: true, updatedAt: true },
        }),
        db.aiProviderConfig.findUnique({
          where: { organizationId },
          select: { updatedAt: true },
        }),
        db.knowledgeDocument.findMany({
          where: {
            organizationId,
            archivedAt: null,
            publishedAt: { not: null },
            publishedText: { not: null },
            publishedRevision: { not: null },
            receptionistApprovedRevision: {
              equals: db.knowledgeDocument.fields.publishedRevision,
            },
          },
          select: { publishedCategory: true, updatedAt: true },
        }),
        db.$queryRaw<
          SavedRehearsal[]
        >`SELECT verdict, "createdAt", "updatedAt", snapshot->>'settingsVersion' AS "settingsVersion", snapshot->>'finished' AS finished FROM "ReceptionistRehearsal" WHERE "organizationId"=${organizationId} ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
        db.knowledgeDocument.aggregate({
          where: { organizationId },
          _max: { updatedAt: true },
        }),
      ])
      const categories = new Set(documents.map((row) => row.publishedCategory))
      const knowledge = {
        services: categories.has('SERVICES'),
        pricing: categories.has('PRICING'),
        faqs: categories.has('FAQ'),
      }
      const latest = reports[0]
      let rehearsal:
        | 'not_saved'
        | 'incomplete'
        | 'unreviewed'
        | 'needs_work'
        | 'stale'
        | 'passed' = 'not_saved'
      if (latest) {
        const changed = [
          business?.updatedAt,
          website?.updatedAt,
          provider?.updatedAt,
          knowledgeChanges._max.updatedAt,
        ].some((at) => at && at.getTime() > latest.createdAt.getTime())
        rehearsal =
          !business ||
          latest.settingsVersion !== business.updatedAt.toISOString() ||
          changed
            ? 'stale'
            : latest.finished !== 'true'
              ? 'incomplete'
              : latest.verdict === 'passed'
                ? 'passed'
                : latest.verdict === 'needs_work'
                  ? 'needs_work'
                  : 'unreviewed'
      }
      const websiteSaved = !!website?.allowedOrigins.length
      const nextStep = !ready.hasSavedBusiness
        ? 'business'
        : !Object.values(knowledge).every(Boolean)
          ? 'knowledge'
          : !ready.hasOrganizationAi
            ? 'ai'
            : !websiteSaved
              ? 'website'
              : rehearsal !== 'passed'
                ? 'rehearsal'
                : 'manual_review'
      return pilotProgressSchema.parse({
        state: 'joined',
        checkedAt,
        businessSaved: ready.hasSavedBusiness,
        knowledge,
        aiConfigured: ready.hasOrganizationAi,
        websiteSaved,
        widgetEnabled: website?.enabled ?? false,
        rehearsal,
        nextStep,
      })
    },
    { isolationLevel: 'RepeatableRead' },
  )
}
