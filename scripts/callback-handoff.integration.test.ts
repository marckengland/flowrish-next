import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { HandoffDraft } from '../src/lib/callback-handoff'
const container = `flowrish-handoff-${randomUUID()}`, org = randomUUID(), other = randomUUID(), user = randomUUID(), foreignUser = randomUUID()
let db: PrismaClient, service: typeof import('../src/server/services/callback-handoff'), started = false, callbackId: string, stageId: string, foreignStage: string, leadId: string, contactId: string
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function draft(target: HandoffDraft['target'] = { mode: 'lead', leadId }): Promise<HandoffDraft> { const row = await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } }); return { expectedUpdatedAt: row.updatedAt.toISOString(), target, assigneeId: user, dueDate: new Date(Date.now() + 86400000).toISOString(), acknowledgeDuplicate: false } }
async function preview(input?: HandoffDraft) { return service.previewCallbackHandoff(org, user, callbackId, input ?? await draft()) }
async function commit(input?: HandoffDraft) { const p = await preview(input); return service.commitCallbackHandoff(org, user, callbackId, { draft: p.draft, previewVersion: p.version, confirmed: true }) }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let n = 0; n < 100; n++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable database not ready')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('All provider transport forbidden') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); service = await import('../src/server/services/callback-handoff')
  await db.organization.createMany({ data: [{ id: org, name: 'Synthetic Repairs', slug: org }, { id: other, name: 'Untouched Org', slug: other }] })
  await db.user.createMany({ data: [{ id: user, authId: randomUUID(), name: 'Handoff Admin', email: `${user}@example.invalid` }, { id: foreignUser, authId: randomUUID(), name: 'Foreign user', email: `${foreignUser}@example.invalid` }] })
  await db.organizationMember.createMany({ data: [{ userId: user, organizationId: org }, { userId: foreignUser, organizationId: other }] })
  const role = await db.role.create({ data: { name: `HandoffAdmin-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write', 'contacts:read'].map(key => ({ key })) } } })
  const team = await db.team.create({ data: { name: 'Handoff Team', organizationId: org } }); await db.teamMember.create({ data: { userId: user, teamId: team.id, roleId: role.id } })
  const pipeline = await db.pipeline.create({ data: { name: 'Repairs', organizationId: org, stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); stageId = pipeline.stages[0].id
  const control = await db.pipeline.create({ data: { name: 'Other', organizationId: other, stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); foreignStage = control.stages[0].id
}, 60000)
beforeEach(async () => {
  await db.callbackCrmHandoff.deleteMany(); await db.websiteReceptionistCallback.deleteMany(); await db.task.deleteMany(); await db.lead.deleteMany(); await db.contact.deleteMany()
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId: user, organizationId: org } }, create: { userId: user, organizationId: org }, update: {} })
  await db.stage.update({ where: { id: stageId }, data: { isClosedWon: false } })
  const callback = await db.websiteReceptionistCallback.create({ data: { organizationId: org, sourceSessionId: randomUUID(), fullName: 'Jamie Example', phone: '+639171234567', reason: 'Bicycle repair quote', siteOrigin: 'https://repairs.example.invalid' } }); callbackId = callback.id
  const lead = await db.lead.create({ data: { organizationId: org, firstName: 'Jamie', lastName: 'Example', phone: '+63 (917) 123-4567', stageId } }); leadId = lead.id
  const contact = await db.contact.create({ data: { organizationId: org, firstName: 'Jamie', lastName: 'Example', phone: '+639171234567' } }); contactId = contact.id
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('callback handoff on disposable PostgreSQL without provider transport', () => {
  it('keeps receipt private and matches normalized international phones only inside the organization', async () => {
    expect(sql(`SELECT relrowsecurity FROM pg_class WHERE relname='CallbackCrmHandoff'`)).toBe('t')
    for (const role of ['anon', 'authenticated']) expect(sql(`SELECT has_table_privilege('${role}', '"CallbackCrmHandoff"', 'SELECT,INSERT,UPDATE,DELETE')`)).toBe('f')
    await db.lead.create({ data: { organizationId: other, firstName: 'Private', lastName: 'Match', phone: '+639171234567', stageId: foreignStage } })
    const options = await service.getCallbackHandoffOptions(org, user, callbackId)
    expect(options.leads.map(row => row.id)).toEqual([leadId]); expect(options.contacts.map(row => row.id)).toEqual([contactId]); expect(options.receipt).toBeNull(); expect(options.members.map(row => row.id)).toEqual([user])
    expect(await db.task.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })
  it('previews without writes and creates only the chosen task and immutable receipt on existing lead', async () => {
    const before = await db.lead.findUniqueOrThrow({ where: { id: leadId } }); const p = await preview()
    expect(p.taskDescription).toContain('Bicycle repair quote'); expect(p.taskDescription).toContain(callbackId); expect(await db.task.count()).toBe(0)
    const receipt = await service.commitCallbackHandoff(org, user, callbackId, { draft: p.draft, previewVersion: p.version, confirmed: true })
    expect(receipt.leadId).toBe(leadId); expect(receipt.taskAvailable).toBe(true)
    expect(await db.task.findUnique({ where: { id: receipt.taskId } })).toMatchObject({ organizationId: org, leadId, assigneeId: user, priority: 'MEDIUM', title: p.taskTitle, description: p.taskDescription })
    expect(await db.lead.findUnique({ where: { id: leadId } })).toEqual(before); expect((await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } })).status).toBe('pending')
    expect(await db.activity.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })
  it('requires duplicate acknowledgement and explicitly creates a lead linked to matching contact', async () => {
    const input = await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId })
    await expect(preview(input)).rejects.toMatchObject({ statusCode: 400 })
    const receipt = await commit({ ...input, acknowledgeDuplicate: true })
    expect(receipt.leadId).not.toBe(leadId)
    expect(await db.lead.findUnique({ where: { id: receipt.leadId } })).toMatchObject({ phone: '+639171234567', assignedUserId: user, stageId, leadStatus: 'NEW' })
    expect(await db.leadContact.findUnique({ where: { leadId_contactId: { leadId: receipt.leadId, contactId } } })).not.toBeNull()
    expect(await db.contact.count()).toBe(1)
  })
  it('allows a matching contact’s active linked lead even when the lead phone differs', async () => {
    await db.lead.update({ where: { id: leadId }, data: { phone: '+12025550123' } }); await db.leadContact.create({ data: { leadId, contactId } })
    const options = await service.getCallbackHandoffOptions(org, user, callbackId); expect(options.leads.map(row => row.id)).toContain(leadId)
    expect((await commit()).leadId).toBe(leadId)
  })
  it('serializes concurrent confirmations and retries without duplicating lead or task', async () => {
    const p = await preview({ ...await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId: null }), acknowledgeDuplicate: true })
    const input = { draft: p.draft, previewVersion: p.version, confirmed: true }
    const receipts = await Promise.all(Array.from({ length: 6 }, () => service.commitCallbackHandoff(org, user, callbackId, input)))
    expect(new Set(receipts.map(row => row.taskId)).size).toBe(1); expect(await db.task.count()).toBe(1); expect(await db.lead.count()).toBe(2); expect(await db.callbackCrmHandoff.count()).toBe(1)
  })
  it('retains idempotency when the callback and CRM targets have been deleted', async () => {
    const p = await preview(); const input = { draft: p.draft, previewVersion: p.version, confirmed: true }; const first = await service.commitCallbackHandoff(org, user, callbackId, input)
    await db.websiteReceptionistCallback.delete({ where: { id: callbackId } }); await db.lead.delete({ where: { id: leadId } })
    const retry = await service.commitCallbackHandoff(org, user, callbackId, input)
    expect(retry).toMatchObject({ taskId: first.taskId, leadId: first.leadId, leadAvailable: false, taskAvailable: false }); expect(await db.task.count()).toBe(0); expect(await db.callbackCrmHandoff.count()).toBe(1)
    expect((await service.getCallbackHandoffOptions(org, user, callbackId)).callback).toBeNull()
  })
  it('rejects changed callback, draft, destination or match set after preview', async () => {
    const p = await preview()
    await expect(service.commitCallbackHandoff(org, user, callbackId, { draft: { ...p.draft, dueDate: new Date(Date.now() + 172800000).toISOString() }, previewVersion: p.version, confirmed: true })).rejects.toMatchObject({ statusCode: 409 })
    await db.lead.update({ where: { id: leadId }, data: { firstName: 'Changed' } })
    await expect(service.commitCallbackHandoff(org, user, callbackId, { draft: p.draft, previewVersion: p.version, confirmed: true })).rejects.toMatchObject({ statusCode: 409 })
    const next = await preview(); await db.websiteReceptionistCallback.update({ where: { id: callbackId }, data: { reason: 'Changed request' } })
    await expect(service.commitCallbackHandoff(org, user, callbackId, { draft: next.draft, previewVersion: next.version, confirmed: true })).rejects.toMatchObject({ statusCode: 409 }); expect(await db.task.count()).toBe(0)
  })
  it('rejects foreign callback, lead, contact, stage, assignee and missing membership', async () => {
    await expect(service.getCallbackHandoffOptions(other, user, callbackId)).rejects.toMatchObject({ statusCode: 403 })
    const foreignLead = await db.lead.create({ data: { organizationId: other, firstName: 'Foreign', lastName: 'Lead', phone: '+639171234567', stageId: foreignStage } })
    await expect(preview(await draft({ mode: 'lead', leadId: foreignLead.id }))).rejects.toMatchObject({ statusCode: 400 })
    await expect(preview({ ...await draft(), assigneeId: foreignUser })).rejects.toMatchObject({ statusCode: 400 })
    await expect(preview({ ...await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId: foreignStage, contactId: null }), acknowledgeDuplicate: true })).rejects.toMatchObject({ statusCode: 400 })
    await expect(preview({ ...await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId: randomUUID() }), acknowledgeDuplicate: true })).rejects.toMatchObject({ statusCode: 400 })
    await db.organizationMember.delete({ where: { userId_organizationId: { userId: user, organizationId: org } } })
    await expect(preview()).rejects.toMatchObject({ statusCode: 403 }); expect(await db.task.count()).toBe(0)
  })
  it('rejects deleted or closed leads, closed stages, past dates and unconfirmed requests', async () => {
    const p = await preview(); await db.lead.update({ where: { id: leadId }, data: { isClosed: true } }); await expect(preview()).rejects.toMatchObject({ statusCode: 400 })
    await db.stage.update({ where: { id: stageId }, data: { isClosedWon: true } }); await expect(preview({ ...await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId: null }), acknowledgeDuplicate: true })).rejects.toMatchObject({ statusCode: 400 })
    await expect(preview({ ...p.draft, dueDate: '2020-01-01T00:00:00.000Z' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.commitCallbackHandoff(org, user, callbackId, { draft: p.draft, previewVersion: p.version, confirmed: false })).rejects.toBeDefined(); expect(await db.task.count()).toBe(0)
  })
  it('requires current CRM permissions and current assignee membership at confirmation', async () => {
    const p = await preview(); const input = { draft: p.draft, previewVersion: p.version, confirmed: true }
    const permission = await db.rolePermission.findFirstOrThrow({ where: { role: { name: `HandoffAdmin-${org}` }, key: 'leads:write' } })
    await db.rolePermission.delete({ where: { id: permission.id } })
    try { await expect(service.commitCallbackHandoff(org, user, callbackId, input)).rejects.toMatchObject({ statusCode: 403 }) }
    finally { await db.rolePermission.create({ data: permission }) }
    await db.organizationMember.create({ data: { userId: foreignUser, organizationId: org } })
    try {
      const reassigned = await preview({ ...await draft(), assigneeId: foreignUser })
      await db.organizationMember.delete({ where: { userId_organizationId: { userId: foreignUser, organizationId: org } } })
      await expect(service.commitCallbackHandoff(org, user, callbackId, { draft: reassigned.draft, previewVersion: reassigned.version, confirmed: true })).rejects.toMatchObject({ statusCode: 400 })
    } finally { await db.organizationMember.deleteMany({ where: { userId: foreignUser, organizationId: org } }) }
    expect(await db.task.count()).toBe(0)
  })
  it('reports truncated ambiguous matches and never silently chooses or bypasses duplicate review', async () => {
    await db.contact.createMany({ data: Array.from({ length: 22 }, (_, index) => ({ organizationId: org, firstName: 'Duplicate', lastName: String(index), phone: '+639171234567' })) })
    const choices = await service.getCallbackHandoffOptions(org, user, callbackId); expect(choices.contacts).toHaveLength(20); expect(choices.matchesTruncated).toBe(true)
    await expect(preview(await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId: null }))).rejects.toMatchObject({ code: 'HANDOFF_DUPLICATE' }); expect(await db.task.count()).toBe(0)
  })
  it('returns task provenance only from an organization-scoped receipt', async () => {
    const receipt = await commit()
    expect(await service.getCallbackTaskSource(org, user, receipt.taskId)).toEqual({ callbackId, taskId: receipt.taskId })
    await expect(service.getCallbackTaskSource(org, user, randomUUID())).rejects.toMatchObject({ statusCode: 404 })
    const foreignLead = await db.lead.create({ data: { organizationId: other, firstName: 'Other', lastName: 'Lead', stageId: foreignStage } })
    const task = await db.task.create({ data: { organizationId: other, leadId: foreignLead.id, assigneeId: foreignUser, title: 'Control task', dueDate: new Date() } })
    await expect(service.getCallbackTaskSource(org, user, task.id)).rejects.toMatchObject({ statusCode: 404 })
    await db.websiteReceptionistCallback.delete({ where: { id: callbackId } }); expect(await service.getCallbackTaskSource(org, user, receipt.taskId)).toEqual({ callbackId, taskId: receipt.taskId })
  })
  it('rolls back a new lead and contact link when task creation fails', async () => {
    const p = await preview({ ...await draft({ mode: 'new', firstName: 'Jamie', lastName: 'Example', stageId, contactId }), acknowledgeDuplicate: true })
    sql(`CREATE FUNCTION fail_handoff_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic task failure'; END $$; CREATE TRIGGER fail_handoff BEFORE INSERT ON "Task" FOR EACH ROW EXECUTE FUNCTION fail_handoff_task();`)
    try { await expect(service.commitCallbackHandoff(org, user, callbackId, { draft: p.draft, previewVersion: p.version, confirmed: true })).rejects.toMatchObject({ statusCode: 503 }); expect(await db.lead.count()).toBe(1); expect(await db.task.count()).toBe(0); expect(await db.leadContact.count()).toBe(0); expect(await db.callbackCrmHandoff.count()).toBe(0) }
    finally { sql('DROP TRIGGER fail_handoff ON "Task"; DROP FUNCTION fail_handoff_task();') }
  })
})
