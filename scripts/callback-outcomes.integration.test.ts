import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { CallbackOutcomeDraft } from '../src/lib/callback-outcomes'
const container = `flowrish-outcomes-${randomUUID()}`, org = randomUUID(), other = randomUUID(), admin = randomUUID(), staff = randomUUID(), outsider = randomUUID()
let db: PrismaClient, service: typeof import('../src/server/services/callback-outcomes'), started = false, callbackId: string, leadId: string, taskId: string, stageId: string
const draft: CallbackOutcomeDraft = { outcome: 'reached', action: 'record', notes: 'Staff reported a conversation.', assigneeId: null, dueDate: null }
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function prepared(value = draft, user = admin) { const detail = await service.getCallbackOutcome(org, user, callbackId, {}); const preview = await service.previewCallbackOutcome(org, user, callbackId, { draft: value, expectedVersion: detail.version }); return { draft: preview.draft, expectedVersion: preview.expectedVersion, previewVersion: preview.version, requestId: randomUUID(), confirmed: true as const } }
async function save(value = draft, user = admin) { return service.recordCallbackOutcome(org, user, callbackId, await prepared(value, user)) }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let n = 0; n < 100; n++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable database unavailable')
  const port = docker('port', container, '5432/tcp').split(':').at(-1); process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Provider transport forbidden') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); service = await import('../src/server/services/callback-outcomes')
  await db.organization.createMany({ data: [{ id: org, name: 'Synthetic callback team', slug: org }, { id: other, name: 'Control organization', slug: other }] })
  for (const id of [admin, staff, outsider]) await db.user.create({ data: { id, authId: randomUUID(), name: id === admin ? 'Admin' : 'Staff', email: `${id}@example.invalid` } })
  await db.organizationMember.createMany({ data: [{ organizationId: org, userId: admin }, { organizationId: org, userId: staff }, { organizationId: other, userId: outsider }] })
  for (const [user, permissions] of [[admin, ['admin:settings', 'leads:read', 'leads:write']], [staff, ['leads:read', 'leads:write']]] as const) {
    const role = await db.role.create({ data: { name: `Outcome-${user}`, hierarchy: 3, permissions: { create: permissions.map(key => ({ key })) } } }); const team = await db.team.create({ data: { organizationId: org, name: user } }); await db.teamMember.create({ data: { userId: user, teamId: team.id, roleId: role.id } })
  }
  const pipeline = await db.pipeline.create({ data: { organizationId: org, name: 'Callbacks', stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); stageId = pipeline.stages[0].id
}, 60000)
beforeEach(async () => {
  await db.callbackOutcomeEvent.deleteMany(); await db.callbackCrmHandoff.deleteMany(); await db.websiteReceptionistCallback.deleteMany(); await db.activity.deleteMany(); await db.task.deleteMany(); await db.lead.deleteMany()
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId: staff, organizationId: org } }, create: { userId: staff, organizationId: org }, update: {} })
  const source = await db.websiteReceptionistCallback.create({ data: { organizationId: org, sourceSessionId: randomUUID(), fullName: 'Jamie Example', phone: '+639171234567', reason: 'Repair quote', siteOrigin: 'https://repairs.example.invalid' } }); callbackId = source.id
  const lead = await db.lead.create({ data: { organizationId: org, stageId, firstName: 'Jamie', lastName: 'Example' } }); leadId = lead.id
  const task = await db.task.create({ data: { organizationId: org, leadId, assigneeId: staff, title: 'Callback: Jamie Example', dueDate: new Date(Date.now() - 3600000) } }); taskId = task.id
  await db.callbackCrmHandoff.create({ data: { organizationId: org, callbackId, leadId, taskId, createdById: admin } })
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('callback outcome transactions without providers', () => {
  it('keeps outcomes private, starts with no synthetic history and previews without writes', async () => {
    expect(sql(`SELECT relrowsecurity FROM pg_class WHERE relname='CallbackOutcomeEvent'`)).toBe('t')
    for (const role of ['anon', 'authenticated']) expect(sql(`SELECT has_table_privilege('${role}', '"CallbackOutcomeEvent"', 'SELECT,INSERT,UPDATE,DELETE')`)).toBe('f')
    expect((await service.getCallbackOutcome(org, staff, callbackId, {})).history).toEqual([]); await prepared(); expect(await db.callbackOutcomeEvent.count()).toBe(0); expect(await db.activity.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })
  it('records results and one CRM note without silently completing or rescheduling', async () => {
    const before = await db.task.findUniqueOrThrow({ where: { id: taskId } }); await save(draft, staff)
    expect(await db.task.findUnique({ where: { id: taskId } })).toEqual(before); expect(await db.activity.count()).toBe(1); expect((await db.activity.findFirstOrThrow()).notes).toContain(`\n${draft.notes}\nCallback: ${callbackId}`); expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).lastActivityAt).not.toBeNull()
    const detail = await service.getCallbackOutcome(org, staff, callbackId, {}); expect(detail.history[0]).toMatchObject({ outcome: 'reached', action: 'record', notes: draft.notes, sequence: 1 }); expect(detail.closed).toBe(false); expect((await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } })).status).toBe('pending')
  })
  it('reschedules the same task and explicitly reopens a completed task', async () => {
    await db.task.update({ where: { id: taskId }, data: { isComplete: true, completedAt: new Date() } })
    const input = await prepared({ ...draft, outcome: 'retry', action: 'reschedule', assigneeId: admin, dueDate: '2030-01-01T00:00:00.000Z' }, staff)
    await service.recordCallbackOutcome(org, staff, callbackId, input)
    expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ assigneeId: admin, isComplete: false, completedAt: null, dueDate: new Date('2030-01-01T00:00:00.000Z') }); expect(await db.task.count()).toBe(1); expect(await db.lead.count()).toBe(1)
    expect(await service.recordCallbackOutcome(org, staff, callbackId, input)).toMatchObject({ recorded: true, requestId: input.requestId }); expect(await db.callbackOutcomeEvent.count()).toBe(1)
    await expect(service.getCallbackOutcome(org, staff, callbackId, {})).rejects.toMatchObject({ statusCode: 403 })
  })
  it('closes the task and source together only on explicit close, with final closure', async () => {
    await save({ ...draft, action: 'close' })
    expect(await db.task.findUnique({ where: { id: taskId } })).toMatchObject({ isComplete: true }); expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).completedAt).not.toBeNull(); expect(await db.websiteReceptionistCallback.findUnique({ where: { id: callbackId } })).toMatchObject({ status: 'reviewed', reviewedById: admin })
    const detail = await service.getCallbackOutcome(org, admin, callbackId, {}); expect(detail.closed).toBe(true); expect(detail.canEdit).toBe(false); await expect(prepared()).rejects.toMatchObject({ statusCode: 409 }); expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).isClosed).toBe(false)
  })
  it('makes concurrent exact retries free and rejects request ID reuse with changed data', async () => {
    const input = await prepared(); await Promise.all(Array.from({ length: 6 }, () => service.recordCallbackOutcome(org, admin, callbackId, input))); expect(await db.callbackOutcomeEvent.count()).toBe(1); expect(await db.activity.count()).toBe(1)
    await expect(service.recordCallbackOutcome(org, admin, callbackId, { ...input, draft: { ...draft, notes: 'Changed' } })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('allows only one action from a shared current-state preview', async () => {
    const first = await prepared(), second = { ...first, requestId: randomUUID() }; const results = await Promise.allSettled([service.recordCallbackOutcome(org, admin, callbackId, first), service.recordCallbackOutcome(org, admin, callbackId, second)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(await db.activity.count()).toBe(1); expect(await db.callbackOutcomeEvent.count()).toBe(1)
  })
  it('invalidates approval after task, source, or history changes', async () => {
    const input = await prepared(); await db.task.update({ where: { id: taskId }, data: { dueDate: new Date(Date.now() + 86400000) } }); await expect(service.recordCallbackOutcome(org, admin, callbackId, input)).rejects.toMatchObject({ statusCode: 409 })
    const next = await prepared(); await db.websiteReceptionistCallback.update({ where: { id: callbackId }, data: { reason: 'Updated request' } }); await expect(service.recordCallbackOutcome(org, admin, callbackId, next)).rejects.toMatchObject({ statusCode: 409 }); expect(await db.activity.count()).toBe(0)
  })
  it('enforces organization, assignment, fresh membership and current assignee selection', async () => {
    await expect(service.getCallbackOutcome(other, admin, callbackId, {})).rejects.toMatchObject({ statusCode: 403 }); await expect(service.getCallbackOutcome(org, outsider, callbackId, {})).rejects.toMatchObject({ statusCode: 403 })
    await db.task.update({ where: { id: taskId }, data: { assigneeId: admin } }); await expect(service.getCallbackOutcome(org, staff, callbackId, {})).rejects.toMatchObject({ statusCode: 403 })
    await expect(prepared({ ...draft, action: 'reschedule', assigneeId: outsider, dueDate: '2030-01-01T00:00:00.000Z' })).rejects.toMatchObject({ statusCode: 400 })
    await db.task.update({ where: { id: taskId }, data: { assigneeId: staff } }); const input = await prepared(draft, staff); await db.organizationMember.delete({ where: { userId_organizationId: { userId: staff, organizationId: org } } }); await expect(service.recordCallbackOutcome(org, staff, callbackId, input)).rejects.toMatchObject({ statusCode: 403 })
  })
  it('retains history after source/CRM deletion, never recreates targets, and permits exact acknowledgements', async () => {
    const input = await prepared(); await service.recordCallbackOutcome(org, admin, callbackId, input); await db.websiteReceptionistCallback.delete({ where: { id: callbackId } }); await save({ ...draft, action: 'close' })
    await db.activity.deleteMany(); await db.lead.delete({ where: { id: leadId } }); const detail = await service.getCallbackOutcome(org, admin, callbackId, {}); expect(detail.history).toHaveLength(2); expect(detail.canEdit).toBe(false); expect(detail.task).toBeNull(); expect(detail.source).toBeNull(); await service.recordCallbackOutcome(org, admin, callbackId, input); expect(await db.task.count()).toBe(0); expect(await db.lead.count()).toBe(0)
  })
  it('filters overdue work and applies staff assignment scope', async () => {
    expect((await service.listCallbackOutcomeQueue(org, staff, {})).rows.map(row => row.callbackId)).toEqual([callbackId]); await db.task.update({ where: { id: taskId }, data: { isComplete: true } }); expect((await service.listCallbackOutcomeQueue(org, staff, {})).rows).toEqual([]); expect((await service.listCallbackOutcomeQueue(org, staff, { filter: 'open' })).rows).toHaveLength(1)
    await save({ ...draft, action: 'close' }); expect((await service.listCallbackOutcomeQueue(org, admin, { filter: 'closed' })).rows).toHaveLength(1); expect((await service.listCallbackOutcomeQueue(org, admin, { filter: 'open' })).rows).toHaveLength(0); expect(fetch).not.toHaveBeenCalled()
  })
  it('paginates history by durable sequence and preserves latest version on older pages', async () => {
    for (let n = 0; n < 22; n++) await save({ ...draft, outcome: 'no_answer', notes: `Attempt ${n}` })
    const latest = await service.getCallbackOutcome(org, admin, callbackId, {}); expect(latest.history).toHaveLength(20); expect(latest.history[0].sequence).toBe(22); expect(latest.hasMore).toBe(true)
    const older = await service.getCallbackOutcome(org, admin, callbackId, { before: latest.beforeNext }); expect(older.history.map(row => row.sequence)).toEqual([2, 1]); expect(older.version).toBe(latest.version); expect(older.hasMore).toBe(false)
  })
  it('paginates queues and excludes other owners and organizations', async () => {
    const tasks = Array.from({ length: 22 }, (_, index) => ({ id: randomUUID(), organizationId: org, leadId, assigneeId: index === 21 ? admin : staff, title: `Synthetic work ${index}`, dueDate: new Date(Date.now() - 86400000 + index * 1000) }))
    await db.task.createMany({ data: tasks }); await db.callbackCrmHandoff.createMany({ data: tasks.map(task => ({ organizationId: org, callbackId: randomUUID(), leadId, taskId: task.id, createdById: admin })) })
    const foreignLead = await db.lead.create({ data: { organizationId: other, stageId, firstName: 'Control', lastName: 'Lead' } }); const foreignTask = await db.task.create({ data: { organizationId: other, leadId: foreignLead.id, assigneeId: outsider, title: 'Foreign work', dueDate: new Date(0) } }); await db.callbackCrmHandoff.create({ data: { organizationId: other, callbackId: randomUUID(), leadId: foreignLead.id, taskId: foreignTask.id, createdById: outsider } })
    const first = await service.listCallbackOutcomeQueue(org, admin, {}), second = await service.listCallbackOutcomeQueue(org, admin, { page: 2 }); expect(first.rows).toHaveLength(20); expect(first.hasMore).toBe(true); expect(second.rows).toHaveLength(3); expect(second.hasMore).toBe(false); expect([...first.rows, ...second.rows].some(row => row.taskId === foreignTask.id)).toBe(false)
    const own = await service.listCallbackOutcomeQueue(org, staff, { page: 2 }); expect(own.rows).toHaveLength(2); expect(own.rows.some(row => row.taskId === tasks[21].id)).toBe(false)
  })
  it('requires current CRM permissions and rejects unavailable tasks or invalid confirmations', async () => {
    const input = await prepared(draft, staff), permission = await db.rolePermission.findFirstOrThrow({ where: { role: { name: `Outcome-${staff}` }, key: 'leads:write' } })
    await db.rolePermission.delete({ where: { id: permission.id } })
    try { await expect(service.recordCallbackOutcome(org, staff, callbackId, input)).rejects.toMatchObject({ statusCode: 403 }); await expect(service.listCallbackOutcomeQueue(org, staff, {})).rejects.toMatchObject({ statusCode: 403 }) }
    finally { await db.rolePermission.create({ data: permission }) }
    await expect(service.recordCallbackOutcome(org, staff, callbackId, { ...input, confirmed: false })).rejects.toBeDefined()
    await expect(prepared({ ...draft, action: 'reschedule', assigneeId: staff, dueDate: '2020-01-01T00:00:00.000Z' })).rejects.toMatchObject({ statusCode: 400 })
    await db.task.delete({ where: { id: taskId } }); const detail = await service.getCallbackOutcome(org, admin, callbackId, {}); expect(detail.canEdit).toBe(false); await expect(prepared()).rejects.toMatchObject({ statusCode: 409 }); expect(await db.callbackOutcomeEvent.count()).toBe(0)
  })
  it('rolls back event, source, completion and note when a CRM write fails', async () => {
    const input = await prepared({ ...draft, action: 'close' }); sql(`CREATE FUNCTION fail_outcome_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic note failure'; END $$; CREATE TRIGGER fail_outcome BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION fail_outcome_note();`)
    try { await expect(service.recordCallbackOutcome(org, admin, callbackId, input)).rejects.toMatchObject({ statusCode: 503 }); expect(await db.callbackOutcomeEvent.count()).toBe(0); expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).isComplete).toBe(false); expect((await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } })).status).toBe('pending') }
    finally { sql('DROP TRIGGER fail_outcome ON "Activity"; DROP FUNCTION fail_outcome_note();') }
  })
})
