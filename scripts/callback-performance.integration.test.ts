import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const container = `flowrish-performance-${randomUUID()}`, org = randomUUID(), other = randomUUID(), admin = randomUUID(), owner = randomUUID(), nextOwner = randomUUID(), outsider = randomUUID()
let db: PrismaClient, service: typeof import('../src/server/services/callback-performance'), stageId: string, roleId: string, started = false
const now = new Date('2026-11-03T12:00:00Z'), requestAt = new Date('2026-11-01T01:00:00Z'), handoffAt = new Date('2026-11-01T02:00:00Z'), query = { from: '2026-11-01', to: '2026-11-03' }
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function callback(createdAt = requestAt, organizationId = org) { return db.websiteReceptionistCallback.create({ data: { organizationId, sourceSessionId: randomUUID(), fullName: 'PRIVATE VISITOR', phone: '+12025550123', reason: 'PRIVATE QUESTION', siteOrigin: 'https://sample.example', createdAt } }) }
async function handoff(source?: Awaited<ReturnType<typeof callback>>, createdAt = handoffAt) {
  const c = source ?? await callback(), lead = await db.lead.create({ data: { organizationId: org, firstName: 'PRIVATE', lastName: 'LEAD', stageId } })
  const task = await db.task.create({ data: { organizationId: org, leadId: lead.id, assigneeId: owner, title: 'PRIVATE TASK TITLE', dueDate: now } })
  await db.callbackCrmHandoff.create({ data: { organizationId: org, callbackId: c.id, leadId: lead.id, taskId: task.id, createdById: admin, createdAt } }); return { callback: c, lead, task }
}
async function event(callbackId: string, outcome: string, at = new Date('2026-11-01T03:00:00Z'), action = 'record') { const sequence = await db.callbackOutcomeEvent.count({ where: { callbackId } }); return db.callbackOutcomeEvent.create({ data: { organizationId: org, callbackId, id: randomUUID(), sequence: sequence + 1, outcome, action, notes: 'PRIVATE STAFF NOTES', createdById: admin, createdByName: 'PRIVATE HISTORY ACTOR', requestHash: 'a'.repeat(64), createdAt: at } }) }
async function report(changes: Record<string, unknown> = {}, user = admin) { return service.getCallbackPerformance(org, user, { ...query, ...changes }) }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false; for (let n = 0; n < 100; n++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable database unavailable')
  const port = docker('port', container, '5432/tcp').split(':').at(-1); process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live provider requests forbidden') })); sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); service = await import('../src/server/services/callback-performance')
  await db.organization.createMany({ data: [{ id: org, name: 'Synthetic Performance', slug: org }, { id: other, name: 'Control Organization', slug: other }] })
  for (const id of [admin, owner, nextOwner, outsider]) await db.user.create({ data: { id, authId: randomUUID(), name: id === outsider ? 'FOREIGN PRIVATE OWNER' : 'Sample Owner', email: `${id}@example.invalid` } })
  const team = await db.team.create({ data: { organizationId: org, name: 'Performance Team' } }), foreign = await db.team.create({ data: { organizationId: other, name: 'Foreign Team' } })
  const full = await db.role.create({ data: { name: `PerformanceAdmin-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ key })) } } }); roleId = full.id
  const crm = await db.role.create({ data: { name: `PerformanceStaff-${org}`, hierarchy: 3, permissions: { create: ['leads:read', 'leads:write'].map(key => ({ key })) } } })
  await db.teamMember.createMany({ data: [{ userId: admin, teamId: team.id, roleId }, { userId: owner, teamId: team.id, roleId: crm.id }, { userId: outsider, teamId: foreign.id, roleId }] })
  stageId = (await db.pipeline.create({ data: { organizationId: org, name: 'Synthetic Pipeline', stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } })).stages[0].id
}, 60000)
beforeEach(async () => {
  await db.callbackNotification.deleteMany(); await db.callbackResponseTarget.deleteMany(); await db.callbackResponsePolicy.deleteMany(); await db.callbackOutcomeEvent.deleteMany(); await db.callbackCrmHandoff.deleteMany(); await db.websiteReceptionistCallback.deleteMany(); await db.task.deleteMany(); await db.lead.deleteMany()
  for (const userId of [admin, owner, nextOwner]) await db.organizationMember.upsert({ where: { userId_organizationId: { userId, organizationId: org } }, create: { userId, organizationId: org }, update: {} })
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId: outsider, organizationId: other } }, create: { userId: outsider, organizationId: other }, update: {} }); await db.organizationMember.deleteMany({ where: { userId: outsider, organizationId: org } })
  await db.rolePermission.createMany({ data: ['admin:settings', 'leads:read', 'leads:write'].map(key => ({ roleId, key })), skipDuplicates: true }); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now)
})
afterEach(() => { vi.useRealTimers() })
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('read-only callback performance on disposable PostgreSQL', () => {
  it('returns an empty report without creating settings, CRM, alerts or AI usage', async () => {
    const result = await report(); expect(result.counts.requests).toBe(0); expect(result.rows).toEqual([]); expect(result.policy).toEqual({ enabled: false, checkedAt: null }); expect(result.timing.handoff).toEqual({ medianMinutes: null, samples: 0 }); expect(result.timing.contact).toEqual({ medianMinutes: null, samples: 0 })
    for (const count of await Promise.all([db.callbackResponsePolicy.count(), db.callbackResponseTarget.count(), db.callbackNotification.count(), db.lead.count(), db.task.count(), db.aiUsageDay.count()])) expect(count).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires fresh local Settings and CRM permissions and current membership', async () => {
    await expect(report({}, owner)).rejects.toMatchObject({ statusCode: 403 }); await expect(report({}, outsider)).rejects.toMatchObject({ statusCode: 403 })
    await db.organizationMember.create({ data: { userId: outsider, organizationId: org } }); await expect(report({}, outsider)).rejects.toMatchObject({ statusCode: 403 })
    await db.rolePermission.deleteMany({ where: { roleId, key: 'leads:write' } }); await expect(report()).rejects.toMatchObject({ statusCode: 403 })
  })
  it('counts independent milestones once and never invents contact from Retry, closure or completion', async () => {
    await callback(); const retry = await handoff(), closed = await handoff(), contacted = await handoff()
    await event(retry.callback.id, 'retry'); await db.task.update({ where: { id: retry.task.id }, data: { isComplete: true } }); await event(closed.callback.id, 'retry', undefined, 'close'); await event(contacted.callback.id, 'no_answer'); await event(contacted.callback.id, 'reached', new Date('2026-11-02T03:00:00Z')); await event(contacted.callback.id, 'retry', new Date('2026-11-03T03:00:00Z'))
    const data = await report(); expect(data.counts).toEqual({ requests: 4, handedOff: 3, contacted: 1, closed: 1, awaitingHandoff: 1, awaitingContact: 1, awaitingOwner: 1, missedHandoff: 0, missedContact: 0, unavailableCrm: 0 }); expect(data.latest).toEqual({ reached: 0, noAnswer: 0, retry: 3, none: 0 }); expect(data.timing.handoff).toEqual({ medianMinutes: 60, samples: 3 }); expect(data.timing.contact).toEqual({ medianMinutes: 60, samples: 1 }); expect((await report({ bucket: 'contacted' })).rows.map(row => row.callbackId)).toEqual([contacted.callback.id]); expect(JSON.stringify(data)).not.toMatch(/PRIVATE|12025550123|apiKey|Ciphertext/)
  })
  it('uses request-date cohorts, inclusive UTC boundaries, and observed later events', async () => {
    await callback(new Date('2026-10-31T23:59:59.999Z')); const first = await handoff(await callback(new Date('2026-11-01T00:00:00Z'))); const last = await callback(new Date('2026-11-03T23:59:59.999Z')); await callback(new Date('2026-11-04T00:00:00Z')); await event(first.callback.id, 'reached', new Date('2026-11-03T10:00:00Z')); vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
    const data = await report(); expect(data.counts.requests).toBe(2); expect(data.counts.contacted).toBe(1); expect(data.rows[0].callbackId).toBe(last.id); expect((await report({ from: '2026-11-03', to: '2026-11-03' })).counts.handedOff).toBe(0)
  })
  it('uses earliest actual contact and valid elapsed samples, excluding future or pre-handoff events', async () => {
    const a = await handoff(), b = await handoff(await callback(), new Date('2026-11-01T04:00:00Z')); await event(a.callback.id, 'reached', new Date('2026-11-01T03:30:00Z')); await event(a.callback.id, 'no_answer', new Date('2026-11-02T04:00:00Z')); await event(b.callback.id, 'no_answer', new Date('2026-11-01T01:30:00Z')); await event(b.callback.id, 'reached', new Date('2026-11-04T04:00:00Z'))
    const data = await report(); expect(data.counts.contacted).toBe(1); expect(data.timing.handoff).toEqual({ medianMinutes: 120, samples: 2 }); expect(data.timing.contact).toEqual({ medianMinutes: 90, samples: 1 }); expect(data.latest).toEqual({ reached: 0, noAnswer: 1, retry: 0, none: 1 })
  })
  it('filters current owners and unhanded requests without leaking foreign identities', async () => {
    await callback(); const work = await handoff(); expect((await report({ owner })).counts.requests).toBe(1); expect((await report({ owner: 'unassigned' })).counts.requests).toBe(1); await db.task.update({ where: { id: work.task.id }, data: { assigneeId: nextOwner } }); expect((await report({ owner })).counts.requests).toBe(0); expect((await report({ owner: nextOwner })).rows).toHaveLength(1)
    await expect(report({ owner: outsider })).rejects.toMatchObject({ statusCode: 400 }); await db.task.update({ where: { id: work.task.id }, data: { assigneeId: outsider } }); const data = await report(); expect(data.counts.awaitingOwner).toBe(2); expect(data.rows.find(row => row.callbackId === work.callback.id)?.assigneeName).toBeNull(); expect(JSON.stringify(data)).not.toContain('FOREIGN PRIVATE OWNER'); expect(data.owners.map(row => row.id)).not.toContain(outsider)
  })
  it('reports deleted-source handoffs separately and preserves missing CRM history without dead links', async () => {
    const retained = await handoff(), missing = await handoff(); await event(retained.callback.id, 'reached'); await event(missing.callback.id, 'no_answer'); await db.websiteReceptionistCallback.delete({ where: { id: retained.callback.id } }); await db.task.delete({ where: { id: missing.task.id } })
    const data = await report(); expect(data.counts).toMatchObject({ requests: 1, handedOff: 1, contacted: 1, unavailableCrm: 1 }); expect(data.retained.handoffs).toBe(1); expect(data.rows[0]).toMatchObject({ taskId: null, unavailableCrm: true }); const old = await report({ bucket: 'retained' }); expect(old.rows).toMatchObject([{ callbackId: retained.callback.id, requestedAt: null, status: 'deleted', firstContactAt: '2026-11-01T03:00:00.000Z' }]); expect((await report({ from: '2026-11-02', bucket: 'retained' })).rows).toEqual([])
  })
  it('uses live response eligibility and policy versions, never reconciling on reads', async () => {
    const pending = await callback(), work = await handoff(), version = new Date('2026-11-01T00:00:00Z'), due = new Date('2026-11-02T00:00:00Z')
    await db.callbackResponsePolicy.create({ data: { organizationId: org, enabled: true, backupUserId: admin, hours: {}, businessUpdatedAt: version, updatedAt: version, lastCheckedAt: now } }); await db.callbackResponseTarget.createMany({ data: [{ organizationId: org, callbackId: pending.id, phase: 'handoff', startedAt: requestAt, dueAt: due, policyVersion: version }, { organizationId: org, callbackId: work.callback.id, phase: 'attempt', taskId: work.task.id, startedAt: handoffAt, dueAt: due, policyVersion: version }] })
    expect((await report()).counts).toMatchObject({ missedHandoff: 1, missedContact: 1 }); expect((await report({ bucket: 'missed' })).rows).toHaveLength(2); await event(work.callback.id, 'no_answer'); expect((await report()).counts.missedContact).toBe(0); await db.callbackResponsePolicy.update({ where: { organizationId: org }, data: { updatedAt: now } }); expect((await report()).counts.missedHandoff).toBe(0); await db.callbackResponsePolicy.update({ where: { organizationId: org }, data: { enabled: false, updatedAt: version } }); expect((await report()).counts.missedHandoff).toBe(0); expect(await db.callbackNotification.count()).toBe(0); expect(await db.callbackResponseTarget.count()).toBe(2)
  })
  it('keeps historical milestones but hides waiting work and links for inactive CRM destinations', async () => {
    const closedLead = await handoff(), deletedLead = await handoff(); await event(closedLead.callback.id, 'reached'); await db.lead.update({ where: { id: closedLead.lead.id }, data: { isClosed: true } }); await db.lead.update({ where: { id: deletedLead.lead.id }, data: { deletedAt: now } }); const data = await report(); expect(data.counts).toMatchObject({ requests: 2, handedOff: 2, contacted: 1, awaitingContact: 0, unavailableCrm: 2 }); expect(data.rows.every(row => row.taskId === null && row.unavailableCrm)).toBe(true)
  })
  it('excludes other organizations and paginates deterministic detail independently of totals', async () => {
    await callback(requestAt, other); for (let n = 0; n < 23; n++) await callback(); const first = await report(), second = await report({ page: 2 }); expect(first.counts.requests).toBe(23); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(3); expect(first.hasMore).toBe(true); expect(second.hasMore).toBe(false); expect(new Set([...first.rows, ...second.rows].map(row => row.callbackId)).size).toBe(23)
    await db.websiteReceptionistCallback.updateMany({ where: { organizationId: org }, data: { status: 'reviewed' } }); expect((await report({ bucket: 'awaiting_handoff' })).rows).toEqual([])
  })
})
