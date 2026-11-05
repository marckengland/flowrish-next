import 'server-only'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { followUpSnoozeInput } from '@/lib/follow-up-snooze'
import { resolveLocalMinute } from '@/lib/callback-time'
import { followUpChanged, followUpLead, followUpUnavailable, followUpView, lockFollowUpMember, requireFollowUpWrites, safeFollowUp } from './follow-up-access'
import { followUpSnoozeWritesEnabled } from './follow-up-snooze-policy'
type Source = { id: string; leadId: string; taskId: string | null; status: string; assigneeId: string; updatedAt: Date; sourceKey?: string; sourceId?: string; sourceThreadId?: string | null }
type Snooze = { until: Date | null; timeZone: string; revision: number }
export function snoozeView<T extends Source>(row: T, snooze: Snooze | null) {
  const snoozeVersion = createHash('sha256').update(JSON.stringify([row.id, row.leadId, row.taskId, row.status, row.assigneeId, row.updatedAt, row.sourceKey, row.sourceId, row.sourceThreadId, snooze?.revision ?? 0])).digest('hex')
  return { ...row, snoozeVersion, snooze: snooze ? { until: snooze.until?.toISOString() ?? null, timeZone: snooze.timeZone, revision: snooze.revision } : null }
}
export async function snoozeClock(db: Prisma.TransactionClient) { const [row] = await db.$queryRaw<Array<{ now: Date }>>`SELECT statement_timestamp() AS now`; if (!row || !Number.isFinite(row.now.getTime())) throw new AppError('FOLLOW_UP_UNAVAILABLE', 'Current reminder time could not be verified.', 503); return row.now }
export async function changeFollowUpSnooze(organizationId: string, userId: string, id: string, raw: unknown) {
  const input = followUpSnoozeInput.parse(raw)
  requireFollowUpWrites()
  if (!followUpSnoozeWritesEnabled()) throw new AppError('FOLLOW_UP_SNOOZE_PAUSED', 'Snooze changes are temporarily paused. Existing reminders are retained.', 503)
  return safeFollowUp(() => prisma.$transaction(async db => {
    await lockFollowUpMember(db, organizationId, userId)
    const where = { id, organizationId, assigneeId: userId }, before = await db.followUpSuggestion.findFirst({ where })
    if (!before) throw followUpUnavailable()
    await db.$queryRaw`SELECT id FROM "Lead" WHERE id=${before.leadId} AND "organizationId"=${organizationId} FOR SHARE`
    if (before.taskId) await db.$queryRaw`SELECT id FROM "Task" WHERE id=${before.taskId} AND "organizationId"=${organizationId} FOR UPDATE`
    await db.$queryRaw`SELECT id FROM "FollowUpSuggestion" WHERE id=${id} AND "organizationId"=${organizationId} FOR UPDATE`
    const row = await db.followUpSuggestion.findFirst({ where })
    if (!row || row.status !== 'PENDING') throw followUpUnavailable()
    if (row.leadId !== before.leadId || row.taskId !== before.taskId) throw followUpChanged()
    await followUpLead(db, organizationId, userId, row.leadId, true)
    if (row.sourceType === 'CALL' && !row.taskId) throw followUpUnavailable()
    if (row.taskId && !await db.task.findFirst({ where: { id: row.taskId, organizationId, leadId: row.leadId, assigneeId: userId, isComplete: false } })) throw followUpUnavailable()
    const key = { organizationId_userId_followUpId: { organizationId, userId, followUpId: id } }, existing = await db.followUpSnooze.findUnique({ where: key })
    if (snoozeView(row, existing).snoozeVersion !== input.expectedVersion) throw followUpChanged()
    const now = await snoozeClock(db)
    let until: Date | null = null, timeZone = existing?.timeZone ?? 'UTC'
    if (input.action === 'snooze') {
      try { until = new Date(resolveLocalMinute(input.localTime, input.timeZone)) } catch { throw new AppError('VALIDATION_ERROR', 'Choose a valid, unambiguous local date and time.', 400) }
      if (until.getTime() <= now.getTime() || until.getTime() > now.getTime() + 365 * 86400000) throw new AppError('VALIDATION_ERROR', 'Choose a future snooze time within the next 365 days.', 400)
      timeZone = input.timeZone
    } else if (!existing?.until) throw followUpChanged()
    const saved = await db.followUpSnooze.upsert({ where: key, create: { organizationId, userId, followUpId: id, until, timeZone }, update: { until, timeZone, revision: { increment: 1 } } })
    await db.auditEntry.create({ data: { organizationId, userId, action: 'UPDATE', entityType: 'FollowUpSnooze', entityId: id, changes: { action: input.action, until: until?.toISOString() ?? null, timeZone, revision: saved.revision } } })
    const final = await followUpLead(db, organizationId, userId, row.leadId, true)
    if (until && until <= await snoozeClock(db)) throw new AppError('VALIDATION_ERROR', 'The selected time elapsed during saving. Choose a new future time.', 400)
    return snoozeView(followUpView(row, final.lead), saved)
  }, { timeout: 20000 }))
}
