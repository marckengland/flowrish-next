import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const container = `flowrish-response-${randomUUID()}`, org = randomUUID(), other = randomUUID(), admin = randomUUID(), manager = randomUUID(), owner = randomUUID(), nextOwner = randomUUID(), outsider = randomUUID()
let db: PrismaClient, policy: typeof import('../src/server/services/callback-response'), job: typeof import('../src/server/services/callback-response-reconciliation'), notifications: typeof import('../src/server/services/callback-notifications'), stageId: string, managerRole: string, started = false
const now = '2026-11-06T08:00:00.000Z', start = new Date('2026-11-06T01:00:00.000Z'), hours = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function source(at = start) { return db.websiteReceptionistCallback.create({ data: { organizationId: org, sourceSessionId: randomUUID(), fullName: 'PRIVATE VISITOR', phone: '+12025550123', reason: 'PRIVATE QUESTION', siteOrigin: 'https://sample.example', createdAt: at } }) }
async function work(callback?: Awaited<ReturnType<typeof source>>) {
  const saved = callback ?? await source(), lead = await db.lead.create({ data: { organizationId: org, firstName: 'Private', lastName: 'Lead', stageId } })
  const task = await db.task.create({ data: { organizationId: org, leadId: lead.id, assigneeId: owner, title: 'Private task', dueDate: new Date('2026-11-10T08:00:00Z') } })
  await db.callbackCrmHandoff.create({ data: { organizationId: org, callbackId: saved.id, leadId: lead.id, taskId: task.id, createdById: admin, createdAt: start } }); return { callback: saved, lead, task }
}
async function save(changes: Record<string, unknown> = {}) { const data = await policy.getCallbackResponsePolicy(org, admin); return policy.saveCallbackResponsePolicy(org, admin, { enabled: true, handoffMinutes: 60, attemptMinutes: 120, backupUserId: manager, expectedUpdatedAt: data.policy.updatedAt, expectedBusinessUpdatedAt: data.business.updatedAt, acknowledged: true, ...changes }) }
async function rows(user = admin, filter = 'all') { return policy.listCallbackResponseTargets(org, user, { filter, page: 1 }) }
async function report(callbackId: string, outcome: string, action = 'record') { const sequence = await db.callbackOutcomeEvent.count({ where: { callbackId } }); return db.callbackOutcomeEvent.create({ data: { organizationId: org, callbackId, id: randomUUID(), sequence: sequence + 1, outcome, action, notes: 'PRIVATE STAFF NOTE', createdById: admin, createdByName: 'Synthetic Staff', requestHash: 'a'.repeat(64), createdAt: new Date() } }) }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false; for (let n = 0; n < 100; n++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable database unavailable')
  const port = docker('port', container, '5432/tcp').split(':').at(-1); process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live provider requests forbidden') })); sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); policy = await import('../src/server/services/callback-response'); job = await import('../src/server/services/callback-response-reconciliation'); notifications = await import('../src/server/services/callback-notifications')
  await db.organization.createMany({ data: [{ id: org, name: 'Response Organization', slug: org }, { id: other, name: 'Control Organization', slug: other }] })
  for (const id of [admin, manager, owner, nextOwner, outsider]) await db.user.create({ data: { id, authId: randomUUID(), name: id === manager ? 'Escalation Manager' : 'Synthetic Staff', email: `${id}@example.invalid` } })
  const team = await db.team.create({ data: { organizationId: org, name: 'Response Team' } }), foreign = await db.team.create({ data: { organizationId: other, name: 'Foreign Team' } })
  const full = await db.role.create({ data: { name: `ResponseAdmin-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ key })) } } }), crm = await db.role.create({ data: { name: `ResponseStaff-${org}`, hierarchy: 3, permissions: { create: ['leads:read', 'leads:write'].map(key => ({ key })) } } })
  managerRole = (await db.role.create({ data: { name: `ResponseManager-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ key })) } } })).id
  for (const userId of [admin, manager, owner, nextOwner]) await db.teamMember.create({ data: { userId, teamId: team.id, roleId: userId === admin ? full.id : userId === manager ? managerRole : crm.id } })
  await db.teamMember.create({ data: { userId: outsider, teamId: foreign.id, roleId: full.id } })
  stageId = (await db.pipeline.create({ data: { organizationId: org, name: 'Synthetic Pipeline', stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } })).stages[0].id
}, 60000)
beforeEach(async () => {
  await db.callbackNotification.deleteMany(); await db.callbackResponseTarget.deleteMany(); await db.callbackResponsePolicy.deleteMany(); await db.callbackOutcomeEvent.deleteMany(); await db.callbackCrmHandoff.deleteMany(); await db.websiteReceptionistCallback.deleteMany(); await db.task.deleteMany(); await db.lead.deleteMany(); await db.receptionistConfig.deleteMany()
  for (const userId of [admin, manager, owner, nextOwner, outsider]) await db.organizationMember.upsert({ where: { userId_organizationId: { userId, organizationId: org } }, create: { userId, organizationId: org }, update: {} })
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId: outsider, organizationId: other } }, create: { userId: outsider, organizationId: other }, update: {} }); await db.rolePermission.createMany({ data: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ roleId: managerRole, key })), skipDuplicates: true })
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)); await db.receptionistConfig.create({ data: { organizationId: org, settings: { ...hours, enabled: false, businessName: 'Synthetic Repairs', knowledge: 'PRIVATE PHONE DATA', forwardTo: '+12025550123', mode: 'always', assigneeId: owner, stageId } } })
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('business-hours response policies and escalations', () => {
  it('is private and disabled by default, with read-only safe metadata', async () => {
    for (const table of ['CallbackResponsePolicy', 'CallbackResponseTarget']) { expect(sql(`SELECT relrowsecurity FROM pg_class WHERE oid='"${table}"'::regclass`)).toBe('t'); for (const role of ['anon', 'authenticated']) expect(sql(`SELECT has_table_privilege('${role}','"${table}"','SELECT')`)).toBe('f') }
    await source(); const data = await policy.getCallbackResponsePolicy(org, admin); expect(data.policy.enabled).toBe(false); expect(data.business.hours).toEqual(hours); expect(JSON.stringify(data)).not.toMatch(/PRIVATE|12025550123|apiKey|Ciphertext/); expect(data.managers.map(row => row.id)).not.toContain(outsider); expect((await rows()).rows).toEqual([]); expect(await db.callbackResponsePolicy.count()).toBe(0); expect(await db.callbackNotification.count()).toBe(0)
  })
  it('requires fresh admin access, acknowledgements and a current qualified manager', async () => {
    await expect(policy.getCallbackResponsePolicy(org, owner)).rejects.toMatchObject({ statusCode: 403 }); await expect(policy.getCallbackResponsePolicy(org, outsider)).rejects.toMatchObject({ statusCode: 403 })
    for (const changes of [{ acknowledged: false }, { backupUserId: owner }, { backupUserId: outsider }, { handoffMinutes: 0 }, { invented: true }]) await expect(save(changes)).rejects.toBeDefined()
    expect(await db.callbackResponsePolicy.count()).toBe(0); await save(); expect(await db.callbackResponseTarget.count()).toBe(0); expect(await db.callbackNotification.count()).toBe(0)
  })
  it('protects stale policy and business versions and preserves private phone configuration', async () => {
    const first = await save(); await expect(save({ expectedUpdatedAt: null })).rejects.toMatchObject({ statusCode: 409 }); const current = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })
    await db.receptionistConfig.update({ where: { organizationId: org }, data: { settings: { ...(current.settings as Record<string, unknown>), opensAt: '10:00' }, updatedAt: new Date(current.updatedAt.getTime() + 1000) } })
    await expect(save({ expectedBusinessUpdatedAt: first.business.updatedAt })).rejects.toMatchObject({ statusCode: 409 }); const metadata = await policy.getCallbackResponsePolicy(org, admin); expect(metadata.hoursChanged).toBe(true); expect(metadata.policy.hours).toEqual(hours); const next = await save(); expect(next.policy.hours?.opensAt).toBe('10:00'); expect((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).toMatchObject({ enabled: false, knowledge: 'PRIVATE PHONE DATA', assigneeId: owner })
  })
  it('creates one deadline and manager escalation, retaining read receipts across retries', async () => {
    const callback = await source(); await save(); await job.reconcileCallbackResponseTargets(org); const data = await rows(); expect(data.rows).toMatchObject([{ callbackId: callback.id, phase: 'handoff', dueAt: '2026-11-06T02:00:00.000Z', missed: true }]); const alerts = (await notifications.listCallbackNotifications(org, manager, { filter: 'all', page: 1 }, true)).rows.filter(row => row.kind === 'handoff_escalation'); expect(alerts).toHaveLength(1)
    const version = (await policy.getCallbackResponsePolicy(org, admin)).policy.updatedAt; await notifications.readCallbackNotification(org, manager, alerts[0].key); await Promise.all([job.reconcileCallbackResponseTargets(org), job.reconcileCallbackResponseTargets(org)]); expect((await notifications.listCallbackNotifications(org, manager, { filter: 'unread', page: 1 }, true)).rows.filter(row => row.kind === 'handoff_escalation')).toEqual([]); expect((await policy.getCallbackResponsePolicy(org, admin)).policy.updatedAt).toBe(version); expect((await policy.getCallbackResponsePolicy(org, admin)).policy.lastCheckedAt).not.toBeNull(); expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps the same policy version and receipts when identical settings are saved again', async () => {
    await source(); const before = await save(); await job.reconcileCallbackResponseTargets(org); const after = await save(); expect(after.policy.updatedAt).toBe(before.policy.updatedAt); expect((await rows()).rows).toHaveLength(1); expect((await notifications.getCallbackNotificationCount(org, manager, true)).unread).toBe((await notifications.getCallbackNotificationCount(org, manager)).unread + 1)
    expect((await notifications.listCallbackNotifications(org, manager, { filter: 'all', page: 1 })).rows.every(row => !row.kind.endsWith('_escalation'))).toBe(true)
  })
  it('ends handoff waiting after approval and starts contact time from the receipt', async () => {
    const callback = await source(); await save(); await job.reconcileCallbackResponseTargets(org); const { task } = await work(callback); expect((await rows()).rows).toEqual([]); await job.reconcileCallbackResponseTargets(org); expect((await rows(owner)).rows).toMatchObject([{ phase: 'attempt', taskId: task.id, startedAt: start.toISOString(), dueAt: '2026-11-06T03:00:00.000Z' }]); expect((await notifications.listCallbackNotifications(org, manager, { filter: 'all', page: 1 }, true)).rows.filter(row => row.kind === 'handoff_escalation')).toEqual([])
  })
  it('does not invent contact from Retry or manual task completion, and keeps retained CRM work', async () => {
    const { callback, task } = await work(); await save(); await report(callback.id, 'retry'); await db.task.update({ where: { id: task.id }, data: { isComplete: true } }); await db.websiteReceptionistCallback.delete({ where: { id: callback.id } }); await job.reconcileCallbackResponseTargets(org); expect((await rows(owner)).rows).toHaveLength(1); await report(callback.id, 'no_answer'); expect((await rows()).rows).toEqual([]); expect((await notifications.listCallbackNotifications(org, manager, { filter: 'all', page: 1 }, true)).rows.filter(row => row.kind === 'attempt_escalation')).toEqual([])
  })
  it('does not reset the first-attempt deadline on reassignment or rescheduling', async () => {
    const { task } = await work(); await save(); await job.reconcileCallbackResponseTargets(org); const due = (await rows(owner)).rows[0].dueAt; await db.task.update({ where: { id: task.id }, data: { assigneeId: nextOwner, dueDate: new Date('2030-01-01') } }); expect((await rows(owner)).rows).toEqual([]); expect((await rows(nextOwner)).rows[0].dueAt).toBe(due); expect((await rows(outsider)).rows).toEqual([]); await job.reconcileCallbackResponseTargets(org); expect((await notifications.listCallbackNotifications(org, manager, { filter: 'all', page: 1 }, true)).rows.filter(row => row.kind === 'attempt_escalation')).toHaveLength(1)
  })
  it('pauses safely after hours become invalid or the selected manager is removed', async () => {
    await source(); await save(); await job.reconcileCallbackResponseTargets(org); await db.organizationMember.delete({ where: { userId_organizationId: { userId: manager, organizationId: org } } }); const meta = await policy.getCallbackResponsePolicy(org, admin); expect(meta.managerAvailable).toBe(false)
    await db.receptionistConfig.update({ where: { organizationId: org }, data: { settings: { broken: true } } }); await save({ enabled: false, acknowledged: false }); expect((await rows()).rows).toEqual([]); expect((await notifications.listCallbackNotifications(org, admin, { filter: 'all', page: 1 }, true)).rows.every(row => !row.kind.endsWith('_escalation'))).toBe(true)
  })
  it.each(['reviewed', 'dismissed', 'deleted'] as const)('hides handoff flags once the source is %s', async status => {
    const callback = await source(); await save(); await job.reconcileCallbackResponseTargets(org); if (status === 'deleted') await db.websiteReceptionistCallback.delete({ where: { id: callback.id } }); else await db.websiteReceptionistCallback.update({ where: { id: callback.id }, data: { status } }); expect((await rows()).rows).toEqual([])
  })
  it.each(['reached', 'close', 'deletedTask', 'closedLead', 'deletedLead'] as const)('hides contact flags after %s', async action => {
    const { callback, lead, task } = await work(); await save(); await job.reconcileCallbackResponseTargets(org)
    if (action === 'reached') await report(callback.id, 'reached'); if (action === 'close') await report(callback.id, 'retry', 'close'); if (action === 'deletedTask') await db.task.delete({ where: { id: task.id } }); if (action === 'closedLead') await db.lead.update({ where: { id: lead.id }, data: { isClosed: true } }); if (action === 'deletedLead') await db.lead.update({ where: { id: lead.id }, data: { deletedAt: new Date() } }); expect((await rows()).rows).toEqual([])
  })
  it('carries weekends and escalates only after a business deadline passes', async () => {
    vi.setSystemTime(new Date('2026-11-06T08:45:00Z')); await source(new Date('2026-11-06T08:30:00.123Z')); await save(); await job.reconcileCallbackResponseTargets(org); expect((await rows()).rows[0]).toMatchObject({ dueAt: '2026-11-09T01:30:00.123Z', missed: false }); expect((await rows(admin, 'missed')).rows).toEqual([]); vi.setSystemTime(new Date('2026-11-09T01:31:00Z')); await job.reconcileCallbackResponseTargets(org); expect((await rows(admin, 'missed')).rows).toHaveLength(1)
  })
  it('invalidates old deadlines and read escalations when an explicit policy version changes', async () => {
    await source(); await save(); await job.reconcileCallbackResponseTargets(org); const old = (await rows()).rows[0].dueAt; await save({ handoffMinutes: 120 }); expect((await rows()).rows).toEqual([]); await job.reconcileCallbackResponseTargets(org); expect((await rows()).rows[0].dueAt).not.toBe(old); expect((await notifications.listCallbackNotifications(org, manager, { filter: 'all', page: 1 }, true)).rows.filter(row => row.kind === 'handoff_escalation')).toHaveLength(1)
  })
  it('paginates current flags and leaves ordinary notification keys and CRM records unchanged', async () => {
    for (let n = 0; n < 24; n++) await source(); await notifications.reconcileCallbackNotifications(org); const before = await db.callbackNotification.findMany({ where: { kind: 'new_callback' }, orderBy: { key: 'asc' } }); await save(); await job.reconcileCallbackResponseTargets(org); expect(await db.callbackNotification.findMany({ where: { kind: 'new_callback' }, orderBy: { key: 'asc' } })).toEqual(before); const first = await rows(), second = await policy.listCallbackResponseTargets(org, admin, { filter: 'all', page: 2 }); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(4); expect(first.hasMore).toBe(true); expect(await db.lead.count()).toBe(0); expect(await db.task.count()).toBe(0); expect(await db.activity.count()).toBe(0); expect(await db.aiUsageDay.count()).toBe(0)
  })
})
