import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const container = `flowrish-alerts-${randomUUID()}`, org = randomUUID(), other = randomUUID(), admin = randomUUID(), owner = randomUUID(), nextOwner = randomUUID(), outsider = randomUUID(), crossRole = randomUUID()
let db: PrismaClient, service: typeof import('../src/server/services/callback-notifications'), started = false, stageId: string, adminRole: string, ownerRole: string
const all = { filter: 'all', page: 1 }, unread = { filter: 'unread', page: 1 }
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function source(organizationId = org) { return db.websiteReceptionistCallback.create({ data: { organizationId, sourceSessionId: randomUUID(), fullName: 'PRIVATE VISITOR NAME', phone: '+12025550123', reason: 'PRIVATE CALLBACK REASON', siteOrigin: 'https://sample.example' } }) }
async function work(existing?: Awaited<ReturnType<typeof source>>) {
  const callback = existing ?? await source(), lead = await db.lead.create({ data: { organizationId: org, firstName: 'Private', lastName: 'Lead', stageId } })
  const task = await db.task.create({ data: { organizationId: org, leadId: lead.id, assigneeId: owner, title: 'Private callback title', dueDate: new Date(Date.now() + 86400000) } })
  await db.callbackCrmHandoff.create({ data: { organizationId: org, callbackId: callback.id, leadId: lead.id, taskId: task.id, createdById: admin } })
  return { callback, lead, task }
}
async function changedTask(taskId: string, data: Record<string, unknown>) { const task = await db.task.findUniqueOrThrow({ where: { id: taskId } }); return db.task.update({ where: { id: taskId }, data: { ...data, updatedAt: new Date(task.updatedAt.getTime() + 1000) } }) }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let n = 0; n < 100; n++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable database unavailable')
  const port = docker('port', container, '5432/tcp').split(':').at(-1); process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live provider transport forbidden') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); service = await import('../src/server/services/callback-notifications')
  await db.organization.createMany({ data: [{ id: org, name: 'Alerts Organization', slug: org }, { id: other, name: 'Control Organization', slug: other }] })
  for (const id of [admin, owner, nextOwner, outsider, crossRole]) await db.user.create({ data: { id, authId: randomUUID(), name: 'Synthetic User', email: `${id}@example.invalid` } })
  const team = await db.team.create({ data: { organizationId: org, name: 'Alerts Team' } }), otherTeam = await db.team.create({ data: { organizationId: other, name: 'Control Team' } })
  adminRole = (await db.role.create({ data: { name: `AlertsAdmin-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ key })) } } })).id
  ownerRole = (await db.role.create({ data: { name: `AlertsOwner-${org}`, hierarchy: 3, permissions: { create: ['leads:read', 'leads:write'].map(key => ({ key })) } } })).id
  for (const userId of [admin, owner, nextOwner]) await db.teamMember.create({ data: { userId, teamId: team.id, roleId: userId === admin ? adminRole : ownerRole } })
  for (const userId of [outsider, crossRole]) await db.teamMember.create({ data: { userId, teamId: otherTeam.id, roleId: adminRole } })
  const pipeline = await db.pipeline.create({ data: { organizationId: org, name: 'Synthetic Pipeline', stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); stageId = pipeline.stages[0].id
}, 60000)
beforeEach(async () => {
  await db.callbackNotification.deleteMany(); await db.callbackOutcomeEvent.deleteMany(); await db.callbackCrmHandoff.deleteMany(); await db.websiteReceptionistCallback.deleteMany(); await db.task.deleteMany(); await db.lead.deleteMany()
  for (const userId of [admin, owner, nextOwner, crossRole]) await db.organizationMember.upsert({ where: { userId_organizationId: { userId, organizationId: org } }, create: { userId, organizationId: org }, update: {} })
  for (const userId of [outsider, crossRole]) await db.organizationMember.upsert({ where: { userId_organizationId: { userId, organizationId: other } }, create: { userId, organizationId: other }, update: {} })
  await db.rolePermission.createMany({ data: [{ roleId: adminRole, key: 'admin:settings' }, ...['leads:read', 'leads:write'].map(key => ({ roleId: ownerRole, key }))], skipDuplicates: true })
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('private callback alerts on disposable PostgreSQL', () => {
  it('enforces event keys and target shape in the database', async () => {
    const data = { organizationId: org, userId: admin, key: 'a'.repeat(64), kind: 'new_callback', callbackId: randomUUID(), entityVersion: new Date() }
    await expect(db.callbackNotification.create({ data: { ...data, key: 'bad' } })).rejects.toBeDefined()
    await expect(db.callbackNotification.create({ data: { ...data, kind: 'unknown' } })).rejects.toBeDefined()
    await expect(db.callbackNotification.create({ data: { ...data, kind: 'overdue' } })).rejects.toBeDefined()
    expect(await db.callbackNotification.count()).toBe(0)
  })
  it('hides the prior pending request as soon as a handoff exists without altering CRM work', async () => {
    const callback = await source(); await service.reconcileCallbackNotifications(org); expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 1 }); const { task } = await work(callback)
    expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 0 }); await service.reconcileCallbackNotifications(org); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 1 }); expect(await db.task.findUnique({ where: { id: task.id } })).toEqual(task)
  })
  it('unions CRM permissions across current local roles', async () => {
    await db.rolePermission.delete({ where: { roleId_key: { roleId: ownerRole, key: 'leads:write' } } })
    const team = await db.team.create({ data: { organizationId: org, name: 'Extra permission team' } }), role = await db.role.create({ data: { name: `Fragmented-${randomUUID()}`, hierarchy: 3, permissions: { create: { key: 'leads:write' } } } })
    const membership = await db.teamMember.create({ data: { userId: owner, teamId: team.id, roleId: role.id } })
    try { await work(); await service.reconcileCallbackNotifications(org); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 1 }) }
    finally { await db.teamMember.delete({ where: { id: membership.id } }); await db.team.delete({ where: { id: team.id } }); await db.role.delete({ where: { id: role.id } }) }
  })
  it('creates a private constrained table without public role privileges', async () => {
    expect(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='"CallbackNotification"'::regclass`)).toBe('t')
    for (const role of ['anon', 'authenticated']) for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(sql(`SELECT has_table_privilege('${role}','"CallbackNotification"','${permission}')`)).toBe('f')
  })
  it('notifies only current local admins, excludes private text and keeps GET reads read-only', async () => {
    await source(); await source(other)
    expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 0 }); expect((await service.listCallbackNotifications(org, admin, all)).rows).toEqual([]); expect(await db.callbackNotification.count()).toBe(0)
    expect(await service.reconcileCallbackNotifications(org)).toBe(1); expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 1 }); expect(await service.getCallbackNotificationCount(org, crossRole)).toEqual({ unread: 0 }); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 0 })
    const result = await service.listCallbackNotifications(org, admin, all); expect(result.rows[0]).toMatchObject({ kind: 'new_callback', taskId: null }); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|12025550123|apiKey|Ciphertext/)
    await expect(service.listCallbackNotifications(org, outsider, all)).rejects.toMatchObject({ statusCode: 403 }); expect(await db.callbackNotification.count({ where: { organizationId: other } })).toBe(0); expect(fetch).not.toHaveBeenCalled(); expect(await db.aiUsageDay.count()).toBe(0)
  })
  it('deduplicates concurrent sweeps and retries even after an alert was read', async () => {
    await source(); await Promise.all([service.reconcileCallbackNotifications(org), service.reconcileCallbackNotifications(org)]); const row = (await service.listCallbackNotifications(org, admin, all)).rows[0]
    const read = await service.readCallbackNotification(org, admin, row.key); expect(await service.readCallbackNotification(org, admin, row.key)).toEqual(read); expect(await service.reconcileCallbackNotifications(org)).toBe(0); expect(await db.callbackNotification.count()).toBe(1); expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 0 }); expect((await service.listCallbackNotifications(org, admin, unread)).rows).toEqual([]); expect((await service.listCallbackNotifications(org, admin, all)).rows).toHaveLength(1)
    await expect(service.readCallbackNotification(org, owner, row.key)).rejects.toMatchObject({ statusCode: 404 }); await expect(service.readCallbackNotification(org, admin, 'f'.repeat(64))).rejects.toMatchObject({ statusCode: 404 })
  })
  it('replaces a pending admin alert with work for the current CRM owner after handoff', async () => {
    const { callback, task } = await work(); expect(await service.reconcileCallbackNotifications(org)).toBe(1); const row = (await service.listCallbackNotifications(org, owner, all)).rows[0]; expect(row).toMatchObject({ kind: 'assigned', callbackId: callback.id, taskId: task.id }); expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 0 }); expect(await db.task.count()).toBe(1); expect(await db.activity.count()).toBe(0)
  })
  it('replaces assignment with one overdue reminder for each saved task version', async () => {
    const { task } = await work(); await service.reconcileCallbackNotifications(org); await changedTask(task.id, { dueDate: new Date('2000-01-01') }); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 0 }); await service.reconcileCallbackNotifications(org)
    const row = (await service.listCallbackNotifications(org, owner, all)).rows[0]; expect(row.kind).toBe('overdue'); await service.readCallbackNotification(org, owner, row.key); await service.reconcileCallbackNotifications(org); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 0 }); expect(await db.callbackNotification.count()).toBe(2)
    await changedTask(task.id, { dueDate: new Date('2001-01-01') }); await service.reconcileCallbackNotifications(org); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 1 }); expect((await service.listCallbackNotifications(org, owner, all)).rows).toHaveLength(1)
  })
  it('becomes overdue when only time passes, without modifying the task version', async () => {
    const { task } = await work(); await service.reconcileCallbackNotifications(org); expect((await service.listCallbackNotifications(org, owner, all)).rows[0].kind).toBe('assigned')
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(task.dueDate.getTime() + 1))
    try { expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 0 }); expect(await service.reconcileCallbackNotifications(org)).toBe(1); const rows = (await service.listCallbackNotifications(org, owner, all)).rows; expect(rows).toHaveLength(1); expect(rows[0].kind).toBe('overdue'); expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).updatedAt).toEqual(task.updatedAt); expect(await service.reconcileCallbackNotifications(org)).toBe(0) }
    finally { vi.useRealTimers() }
  })
  it('removes access immediately after reassignment and delivers only to the new owner', async () => {
    const { task } = await work(); await service.reconcileCallbackNotifications(org); const row = (await service.listCallbackNotifications(org, owner, all)).rows[0]; await changedTask(task.id, { assigneeId: nextOwner }); expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 0 }); await expect(service.readCallbackNotification(org, owner, row.key)).rejects.toMatchObject({ statusCode: 404 }); await service.reconcileCallbackNotifications(org); expect(await service.getCallbackNotificationCount(org, nextOwner)).toEqual({ unread: 1 }); expect((await service.listCallbackNotifications(org, owner, all)).rows).toEqual([])
  })
  it.each(['reviewed', 'dismissed', 'deleted', 'permission'] as const)('hides unhandled callback alerts after %s', async mode => {
    const callback = await source(); await service.reconcileCallbackNotifications(org); const key = (await service.listCallbackNotifications(org, admin, all)).rows[0].key
    if (mode === 'deleted') await db.websiteReceptionistCallback.delete({ where: { id: callback.id } })
    else if (mode === 'permission') await db.rolePermission.delete({ where: { roleId_key: { roleId: adminRole, key: 'admin:settings' } } })
    else await db.websiteReceptionistCallback.update({ where: { id: callback.id }, data: { status: mode } })
    expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 0 }); await expect(service.readCallbackNotification(org, admin, key)).rejects.toMatchObject({ statusCode: 404 })
  })
  it.each(['complete', 'closed', 'deletedTask', 'deletedLead', 'closedLead', 'crmPermission'] as const)('hides owner alerts after %s', async mode => {
    const { callback, lead, task } = await work(); await service.reconcileCallbackNotifications(org)
    if (mode === 'complete') await changedTask(task.id, { isComplete: true })
    if (mode === 'closed') await db.callbackOutcomeEvent.create({ data: { organizationId: org, callbackId: callback.id, id: randomUUID(), sequence: 1, outcome: 'reached', action: 'close', notes: '', createdById: admin, createdByName: 'Synthetic Staff', requestHash: 'a'.repeat(64) } })
    if (mode === 'deletedTask') await db.task.delete({ where: { id: task.id } })
    if (mode === 'deletedLead') await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } })
    if (mode === 'closedLead') await db.lead.update({ where: { id: lead.id }, data: { isClosed: true } })
    if (mode === 'crmPermission') await db.rolePermission.delete({ where: { roleId_key: { roleId: ownerRole, key: 'leads:write' } } })
    expect(await service.getCallbackNotificationCount(org, owner)).toEqual({ unread: 0 }); expect((await service.listCallbackNotifications(org, owner, all)).rows).toEqual([]); expect(await service.reconcileCallbackNotifications(org)).toBe(0)
  })
  it('paginates deterministically and never resurrects read notifications', async () => {
    for (let n = 0; n < 25; n++) await source(); await service.reconcileCallbackNotifications(org)
    const first = await service.listCallbackNotifications(org, admin, all), second = await service.listCallbackNotifications(org, admin, { ...all, page: 2 }); expect(first.rows).toHaveLength(20); expect(first.hasMore).toBe(true); expect(second.rows).toHaveLength(5); expect(second.hasMore).toBe(false); expect(new Set([...first.rows, ...second.rows].map(row => row.key)).size).toBe(25)
    await service.readCallbackNotification(org, admin, first.rows[0].key); expect(await service.getCallbackNotificationCount(org, admin)).toEqual({ unread: 24 }); expect((await service.listCallbackNotifications(org, admin, all)).rows).toHaveLength(20)
  })
  it('cascades membership deletion and keeps global sweep retries idempotent', async () => {
    await source(); await source(other); const run = await service.runCallbackNotificationSweep(); expect(run.created).toBe(3); expect((await service.runCallbackNotificationSweep()).created).toBe(0)
    await db.organizationMember.delete({ where: { userId_organizationId: { userId: admin, organizationId: org } } }); expect(await db.callbackNotification.count({ where: { organizationId: org, userId: admin } })).toBe(0); await expect(service.getCallbackNotificationCount(org, admin)).rejects.toMatchObject({ statusCode: 403 }); expect(fetch).not.toHaveBeenCalled()
  })
})
