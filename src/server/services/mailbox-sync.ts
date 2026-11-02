import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { inngest } from '@/server/inngest/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'

const intervalMs = 5 * 60 * 1000
const leaseMs = 15 * 60 * 1000
const failureMessage = 'Mailbox sync failed. Try Sync now; reconnect your mailbox if the problem continues.'
const stalledMessage = 'Mailbox sync is taking longer than expected. Try Sync now to retry.'
const providers = ['gmail', 'microsoft']
const healthSelect = { id: true, provider: true, email: true, lastSyncAt: true, syncStatus: true, syncRequestedAt: true, syncAttemptAt: true } as const

export async function listMailboxSyncHealth(organizationId: string, userId: string) {
  const accounts = await prisma.emailAccount.findMany({ where: { organizationId, userId, provider: { in: providers } }, select: healthSelect, orderBy: { provider: 'asc' } })
  const signingKey = process.env.INNGEST_SIGNING_KEY ?? ''
  const eventKey = process.env.INNGEST_EVENT_KEY ?? ''
  const automatic = /^signkey-[\w]+-[\da-f]+$/i.test(signingKey) && eventKey.length > 20 && !/placeholder|example|your[-_ ]|changeme/i.test(eventKey)
  return accounts.map((account) => {
    const busy = account.syncStatus === 'queued' || account.syncStatus === 'running'
    const since = account.syncStatus === 'running' ? account.syncAttemptAt : account.syncRequestedAt
    const stale = busy && (!since || Date.now() - since.getTime() > leaseMs)
    return { id: account.id, provider: account.provider, email: account.email, lastSyncAt: account.lastSyncAt?.toISOString() ?? null, lastAttemptAt: account.syncAttemptAt?.toISOString() ?? null, requestedAt: account.syncRequestedAt?.toISOString() ?? null, status: stale ? 'failed' : account.syncStatus, error: stale ? stalledMessage : account.syncStatus === 'failed' ? failureMessage : null, automatic }
  })
}

async function queueAccount(organizationId: string, accountId: string) {
  const now = new Date()
  const runId = randomUUID()
  // The conditional claim serializes cron and manual requests without holding
  // a database transaction open across the event service network request.
  const claimed = await prisma.emailAccount.updateMany({
    where: { id: accountId, organizationId, OR: [{ syncStatus: { notIn: ['queued', 'running'] } }, { syncStatus: 'queued', syncRequestedAt: { lt: new Date(now.getTime() - leaseMs) } }, { syncStatus: 'running', syncAttemptAt: { lt: new Date(now.getTime() - leaseMs) } }] },
    data: { syncStatus: 'queued', syncRequestedAt: now, syncRunId: runId, syncError: null },
  })
  if (!claimed.count) {
    const current = await prisma.emailAccount.findFirst({ where: { id: accountId, organizationId }, select: { syncStatus: true } })
    if (!current) throw new AppError('NO_EMAIL_ACCOUNT', 'No connected email account.', 400)
    return { accountId, status: current.syncStatus === 'running' ? 'running' as const : 'queued' as const }
  }
  try {
    await inngest.send({ id: runId, name: 'email/sync.requested', data: { accountId, organizationId } })
  } catch {
    await prisma.emailAccount.updateMany({ where: { id: accountId, organizationId, syncRunId: runId }, data: { syncStatus: 'failed', syncError: failureMessage } })
    throw new AppError('SYNC_QUEUE_FAILED', 'Mailbox sync could not be queued. Try again shortly.', 503)
  }
  return { accountId, status: 'queued' as const }
}

export async function requestMailboxSync(organizationId: string, userId: string, provider?: 'gmail' | 'microsoft') {
  const account = await prisma.emailAccount.findFirst({ where: { organizationId, userId, ...(provider ? { provider } : { provider: { in: providers } }) }, orderBy: { updatedAt: 'desc' }, select: { id: true } })
  if (!account) throw new AppError('NO_EMAIL_ACCOUNT', 'No connected email account. Connect Gmail or Outlook before running sync.', 400)
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
  if (!member) throw new AppError('FORBIDDEN', 'Mailbox owner must be a current organization member.', 403)
  return queueAccount(organizationId, account.id)
}

export async function beginMailboxSync(organizationId: string, accountId: string, runId: string): Promise<Date> {
  const account = await prisma.emailAccount.findFirst({ where: { id: accountId, organizationId } })
  if (!account) throw new AppError('NO_EMAIL_ACCOUNT', 'Mailbox is no longer connected.', 404)
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId: account.userId, organizationId } } })
  if (!member) throw new AppError('FORBIDDEN', 'Mailbox owner must be a current organization member.', 403)
  const permissions = await getEffectivePermissions(account.userId, organizationId)
  if (!permissions.has('leads:read') || !permissions.has('leads:write')) throw new AppError('FORBIDDEN', 'Mailbox owner no longer has lead access.', 403)
  if (account.syncRunId && account.syncRunId !== runId) throw new AppError('SYNC_SUPERSEDED', 'A newer mailbox sync was requested.', 409)
  if (account.syncStatus !== 'queued' && account.syncRunId === runId && account.syncAttemptAt) return account.syncAttemptAt
  const startedAt = new Date()
  const claimed = await prisma.emailAccount.updateMany({ where: { id: accountId, organizationId, OR: [{ syncRunId: runId }, { syncRunId: null }] }, data: { syncRunId: runId, syncStatus: 'running', syncAttemptAt: startedAt, syncError: null } })
  if (!claimed.count) throw new AppError('SYNC_SUPERSEDED', 'A newer mailbox sync was requested.', 409)
  return startedAt
}

export async function heartbeatMailboxSync(organizationId: string, accountId: string, runId: string): Promise<void> {
  const renewed = await prisma.emailAccount.updateMany({ where: { id: accountId, organizationId, syncRunId: runId, syncStatus: 'running' }, data: { syncAttemptAt: new Date() } })
  if (!renewed.count) throw new AppError('SYNC_SUPERSEDED', 'A newer mailbox sync was requested.', 409)
}

export async function completeMailboxSync(organizationId: string, accountId: string, runId: string, startedAt: Date): Promise<void> {
  await prisma.emailAccount.updateMany({ where: { id: accountId, organizationId, syncRunId: runId }, data: { lastSyncAt: startedAt, syncStatus: 'healthy', syncError: null } })
}

export async function failMailboxSync(organizationId: string, accountId: string, runId: string): Promise<void> {
  await prisma.emailAccount.updateMany({ where: { id: accountId, organizationId, syncRunId: runId }, data: { syncStatus: 'failed', syncError: failureMessage } })
}

export async function scheduleMailboxSyncs() {
  const now = new Date()
  const accounts = await prisma.emailAccount.findMany({ where: { provider: { in: providers }, AND: [{ OR: [{ lastSyncAt: null }, { lastSyncAt: { lte: new Date(now.getTime() - intervalMs) } }] }, { OR: [{ syncStatus: { notIn: ['queued', 'running'] } }, { syncStatus: 'queued', syncRequestedAt: { lt: new Date(now.getTime() - leaseMs) } }, { syncStatus: 'running', syncAttemptAt: { lt: new Date(now.getTime() - leaseMs) } }] }] }, select: { id: true, userId: true, organizationId: true }, orderBy: { id: 'asc' } })
  let queued = 0
  let failed = 0
  for (const account of accounts) {
    const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId: account.userId, organizationId: account.organizationId } } })
    if (!member) continue
    const permissions = await getEffectivePermissions(account.userId, account.organizationId)
    if (!permissions.has('leads:read') || !permissions.has('leads:write')) continue
    try { const result = await queueAccount(account.organizationId, account.id); if (result.status === 'queued') queued++ } catch { failed++ }
  }
  return { queued, failed }
}
