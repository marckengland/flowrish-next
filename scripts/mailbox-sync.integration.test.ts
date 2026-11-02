import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

const container = `flowrish-autosync-${process.pid}`
let db: PrismaClient
let service: typeof import('../src/server/services/mailbox-sync')
let databaseStarted = false
const orgId = randomUUID()
const otherOrgId = randomUUID()
const userId = randomUUID()
const strangerId = randomUUID()
let accountId: string

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

const send = vi.hoisted(() => vi.fn())
vi.mock('@/server/inngest/client', () => ({ inngest: { send } }))
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16')
  databaseStarted = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`
  process.env.DIRECT_URL = process.env.DATABASE_URL
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) {
    if (name === 'migration_lock.toml') continue
    sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  }
  ;({ prisma: db } = await import('../src/server/db/client'))
  service = await import('../src/server/services/mailbox-sync')
  await db.organization.createMany({ data: [{ id: orgId, name: 'Sync verification', slug: orgId }, { id: otherOrgId, name: 'Control', slug: otherOrgId }] })
  for (const id of [userId, strangerId]) {
    await db.user.create({ data: { id, authId: randomUUID(), name: 'Sync reviewer', email: `${id}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId: orgId, userId: id } })
  }
  const role = await db.role.create({ data: { name: 'Sync reviewer', organizationId: orgId, hierarchy: 3, permissions: { create: [{ key: 'leads:read' }, { key: 'leads:write' }] } } })
  const team = await db.team.create({ data: { organizationId: orgId, name: 'Mailbox team' } })
  await db.teamMember.create({ data: { userId, teamId: team.id, roleId: role.id } })
  const account = await db.emailAccount.create({ data: { organizationId: orgId, userId, provider: 'gmail', email: 'owner@example.invalid', accessToken: 'synthetic-secret', refreshToken: 'synthetic-refresh', tokenExpiry: new Date() } })
  accountId = account.id
})

afterAll(async () => { if (db) await db.$disconnect(); if (databaseStarted) docker('stop', container) })

describe('automatic mailbox sync on disposable PostgreSQL', () => {
  it('queues one event across eight concurrent manual requests', async () => {
    send.mockResolvedValue({ ids: ['synthetic'] })
    const results = await Promise.all(Array.from({ length: 8 }, () => service.requestMailboxSync(orgId, userId, 'gmail')))
    expect(results.every(row => row.accountId === accountId && row.status === 'queued')).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    const row = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(row.syncRunId).toBe(send.mock.calls[0][0].id)
    expect(row.lastSyncAt).toBeNull()
  })

  it('keeps the checkpoint on failure and records a safe failure without leaking provider details', async () => {
    const queued = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    const started = await service.beginMailboxSync(orgId, accountId, queued.syncRunId!)
    await service.failMailboxSync(orgId, accountId, queued.syncRunId!)
    const failed = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(failed.syncStatus).toBe('failed')
    expect(failed.lastSyncAt).toBeNull()
    expect(failed.syncError).not.toContain('synthetic-secret')
    await service.completeMailboxSync(orgId, accountId, queued.syncRunId!, started)
    const healthy = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(healthy.lastSyncAt?.toISOString()).toBe(started.toISOString())
    expect(healthy.syncStatus).toBe('healthy')
    expect(healthy.syncError).toBeNull()
  })

  it('rejects cross-tenant and wrong-user requests and exposes no credentials in health', async () => {
    await expect(service.requestMailboxSync(otherOrgId, userId, 'gmail')).rejects.toThrow()
    await expect(service.requestMailboxSync(orgId, strangerId, 'gmail')).rejects.toThrow()
    expect(await service.listMailboxSyncHealth(otherOrgId, userId)).toEqual([])
    const health = await service.listMailboxSyncHealth(orgId, userId)
    expect(health).toHaveLength(1)
    expect(JSON.stringify(health)).not.toContain('synthetic-secret')
    expect(JSON.stringify(health)).not.toContain('synthetic-refresh')
  })

  it('releases an enqueue failure and allows a retry without advancing the checkpoint', async () => {
    await db.emailAccount.update({ where: { id: accountId }, data: { lastSyncAt: null } })
    send.mockRejectedValueOnce(new Error('Synthetic event-key secret'))
    await expect(service.requestMailboxSync(orgId, userId, 'gmail')).rejects.toThrow('could not be queued')
    const failed = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(failed.syncStatus).toBe('failed')
    expect(failed.syncError).not.toContain('event-key')
    expect(failed.lastSyncAt).toBeNull()
    await service.requestMailboxSync(orgId, userId, 'gmail')
    expect((await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })).syncStatus).toBe('queued')
  })

  it('recovers a stale lease and ignores success/failure from its superseded run', async () => {
    const original = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    await db.emailAccount.update({ where: { id: accountId }, data: { syncRequestedAt: new Date('2020-01-01') } })
    await service.requestMailboxSync(orgId, userId, 'gmail')
    const newer = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(newer.syncRunId).not.toBe(original.syncRunId)
    await service.completeMailboxSync(orgId, accountId, original.syncRunId!, new Date())
    await service.failMailboxSync(orgId, accountId, original.syncRunId!)
    const unchanged = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(unchanged.syncStatus).toBe('queued')
    expect(unchanged.syncRunId).toBe(newer.syncRunId)
    expect(unchanged.lastSyncAt).toBeNull()
  })

  it('scheduler skips busy/recent mailboxes and departed members', async () => {
    send.mockClear()
    await service.scheduleMailboxSyncs()
    expect(send).not.toHaveBeenCalled()
    await db.emailAccount.update({ where: { id: accountId }, data: { syncStatus: 'healthy', lastSyncAt: new Date() } })
    await service.scheduleMailboxSyncs()
    expect(send).not.toHaveBeenCalled()
    await db.emailAccount.update({ where: { id: accountId }, data: { lastSyncAt: null } })
    await db.organizationMember.delete({ where: { userId_organizationId: { userId, organizationId: orgId } } })
    await service.scheduleMailboxSyncs()
    expect(send).not.toHaveBeenCalled()
    await db.organizationMember.create({ data: { userId, organizationId: orgId } })
    await service.scheduleMailboxSyncs()
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('renews a long-running page lease without moving the frozen checkpoint', async () => {
    const queued = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    const startedAt = await service.beginMailboxSync(orgId, accountId, queued.syncRunId!)
    await db.emailAccount.update({ where: { id: accountId }, data: { syncAttemptAt: new Date('2020-01-01') } })
    await service.heartbeatMailboxSync(orgId, accountId, queued.syncRunId!)
    const refreshed = await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })
    expect(refreshed.syncAttemptAt!.getTime()).toBeGreaterThanOrEqual(startedAt.getTime())
    expect(refreshed.lastSyncAt).toBeNull()
    send.mockClear()
    await service.scheduleMailboxSyncs()
    expect(send).not.toHaveBeenCalled()
    await expect(service.heartbeatMailboxSync(orgId, accountId, 'superseded-run')).rejects.toThrow()
    await service.completeMailboxSync(orgId, accountId, queued.syncRunId!, startedAt)
    expect((await db.emailAccount.findUniqueOrThrow({ where: { id: accountId } })).lastSyncAt!.toISOString()).toBe(startedAt.toISOString())
  })

})
