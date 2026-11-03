import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { resolveCallbackTime } from '../src/lib/callback-time'

const container = `flowrish-callback-time-${process.pid}`, migration = '20261103080000_add_preferred_callback_time'
const org = randomUUID(), other = randomUUID(), control = randomUUID(), user = randomUUID(), outsider = randomUUID(), legacyId = randomUUID()
const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const localDate = day.toISOString().slice(0, 10), preference = resolveCallbackTime({ localTime: `${localDate}T10:00`, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
const later = resolveCallbackTime({ localTime: `${localDate}T11:00`, timeZone: calendar.timeZone, businessVersion: calendar.version }, calendar)
let db: PrismaClient, handoff: typeof import('../src/server/services/callback-handoff'), outcomes: typeof import('../src/server/services/callback-outcomes'), stageId: string, leadId: string, callbackId: string, started = false
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
let migrationProof = false
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw Error('Disposable database not ready')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Provider transport forbidden') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml' && name !== migration) sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  sql(`INSERT INTO "Organization" (id,name,slug,"updatedAt") VALUES ('${control}','Untouched migration control','${control}',now()); INSERT INTO "WebsiteReceptionistCallback" (id,"organizationId","sourceSessionId","fullName",phone,reason,"siteOrigin","updatedAt") VALUES ('${legacyId}','${control}','legacy-session','Synthetic Control','+12025550123','Legacy request','https://control.example',now()); CREATE TEMP TABLE ignored (value int);`)
  const before = sql(`SELECT (to_jsonb(c))::text FROM "WebsiteReceptionistCallback" c WHERE id='${legacyId}'`)
  const security = sql(`SELECT relname,relrowsecurity,has_table_privilege('anon',oid,'SELECT'),has_table_privilege('authenticated',oid,'INSERT') FROM pg_class WHERE relname IN ('WebsiteReceptionistCallback','CallbackCrmHandoff','WebsiteReceptionistSession') ORDER BY relname`)
  sql(readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'))
  expect(sql(`SELECT (to_jsonb(c)-'preferredTime')::text FROM "WebsiteReceptionistCallback" c WHERE id='${legacyId}'`)).toBe(before)
  expect(sql(`SELECT relname,relrowsecurity,has_table_privilege('anon',oid,'SELECT'),has_table_privilege('authenticated',oid,'INSERT') FROM pg_class WHERE relname IN ('WebsiteReceptionistCallback','CallbackCrmHandoff','WebsiteReceptionistSession') ORDER BY relname`)).toBe(security)
  migrationProof = true
  ;({ prisma: db } = await import('../src/server/db/client')); handoff = await import('../src/server/services/callback-handoff'); outcomes = await import('../src/server/services/callback-outcomes')
  await db.organization.createMany({ data: [{ id: org, name: 'Synthetic Business', slug: org }, { id: other, name: 'Other', slug: other }] })
  await db.user.createMany({ data: [{ id: user, authId: randomUUID(), name: 'Staff', email: `${user}@example.invalid` }, { id: outsider, authId: randomUUID(), name: 'Other staff', email: `${outsider}@example.invalid` }] })
  await db.organizationMember.createMany({ data: [{ userId: user, organizationId: org }, { userId: outsider, organizationId: other }] })
  const role = await db.role.create({ data: { name: `Timing-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write', 'contacts:read'].map(key => ({ key })) } } })
  const team = await db.team.create({ data: { name: 'Timing team', organizationId: org } }); await db.teamMember.create({ data: { userId: user, teamId: team.id, roleId: role.id } })
  const pipeline = await db.pipeline.create({ data: { name: 'Sales', organizationId: org, stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); stageId = pipeline.stages[0].id
})
beforeEach(async () => {
  await db.callbackOutcomeEvent.deleteMany({ where: { organizationId: org } }); await db.callbackCrmHandoff.deleteMany({ where: { organizationId: org } }); await db.websiteReceptionistCallback.deleteMany({ where: { organizationId: org } }); await db.task.deleteMany({ where: { organizationId: org } }); await db.lead.deleteMany({ where: { organizationId: org } })
  await db.receptionistConfig.upsert({ where: { organizationId: org }, create: { organizationId: org, settings: calendar, updatedAt: new Date(calendar.version) }, update: { settings: calendar, updatedAt: new Date(calendar.version) } })
  callbackId = (await db.websiteReceptionistCallback.create({ data: { organizationId: org, sourceSessionId: randomUUID(), fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Services', siteOrigin: 'https://shop.example', preferredTime: preference } })).id
  leadId = (await db.lead.create({ data: { organizationId: org, firstName: 'Sample', lastName: 'Visitor', phone: '+12025550123', stageId } })).id
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('stop', container) })
async function draft(dueDate = preference.at) { const source = await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } }); return { expectedUpdatedAt: source.updatedAt.toISOString(), target: { mode: 'lead' as const, leadId }, assigneeId: user, dueDate, acknowledgeDuplicate: false } }
async function confirm(dueDate = preference.at) { const value = await draft(dueDate), preview = await handoff.previewCallbackHandoff(org, user, callbackId, value); return handoff.commitCallbackHandoff(org, user, callbackId, { draft: value, previewVersion: preview.version, confirmed: true }) }

describe('preferred callback timing on disposable PostgreSQL', () => {
  it('adds nullable columns without rewriting legacy data or widening table access', async () => { expect(migrationProof).toBe(true); expect((await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: legacyId } })).preferredTime).toBe(null) })
  it('previews requested and staff-confirmed times, creates the chosen deadline and retains the request snapshot', async () => {
    const options = await handoff.getCallbackHandoffOptions(org, user, callbackId)
    expect(options.callback?.preferredTime).toEqual(preference); expect(options.callbackHours).toEqual(calendar)
    const preview = await handoff.previewCallbackHandoff(org, user, callbackId, await draft(later.at))
    expect(preview.confirmedTime?.at).toBe(later.at); expect(preview.taskDescription).toContain('Requested callback time:')
    const receipt = await confirm(later.at); expect(receipt.preferredTime).toEqual(preference)
    expect((await db.task.findUniqueOrThrow({ where: { id: receipt.taskId } })).dueDate.toISOString()).toBe(later.at)
    expect((await db.callbackCrmHandoff.findUniqueOrThrow({ where: { callbackId } })).preferredTime).toEqual(preference)
  })
  it('rejects an out-of-hours staff choice and invalidates preview after saved hours change', async () => {
    await expect(handoff.previewCallbackHandoff(org, user, callbackId, await draft(`${localDate}T09:00:00.000Z`))).rejects.toMatchObject({ statusCode: 400 })
    const value = await draft(), preview = await handoff.previewCallbackHandoff(org, user, callbackId, value)
    await db.receptionistConfig.update({ where: { organizationId: org }, data: { settings: { ...calendar, closesAt: '16:00' } } })
    await expect(handoff.commitCallbackHandoff(org, user, callbackId, { draft: value, previewVersion: preview.version, confirmed: true })).rejects.toMatchObject({ statusCode: 409 })
    expect(await db.task.count({ where: { organizationId: org } })).toBe(0)
  })
  it('keeps requested timing after source removal and reschedules only through staff approval', async () => {
    const receipt = await confirm(); await db.websiteReceptionistCallback.delete({ where: { id: callbackId } })
    const detail = await outcomes.getCallbackOutcome(org, user, callbackId, {})
    expect(detail.source).toBe(null); expect(detail.preferredTime).toEqual(preference); expect(detail.callbackHours).toEqual(calendar)
    const draft = { outcome: 'retry', action: 'reschedule', notes: 'Staff confirmed a later sample time', assigneeId: user, dueDate: later.at }, input = { draft, expectedVersion: detail.version }
    const preview = await outcomes.previewCallbackOutcome(org, user, callbackId, input); expect(preview.confirmedTime?.at).toBe(later.at)
    await outcomes.recordCallbackOutcome(org, user, callbackId, { ...input, requestId: randomUUID(), previewVersion: preview.version, confirmed: true })
    expect((await db.task.findUniqueOrThrow({ where: { id: receipt.taskId } })).dueDate.toISOString()).toBe(later.at)
  })
  it('starts first-contact targets at the staff-confirmed time for timed callbacks', async () => {
    const receipt = await confirm()
    const { responseSourcesSql } = await import('../src/server/services/callback-response-sql')
    const sources = await db.$queryRaw<Array<{ callbackId: string; phase: string; startedAt: Date }>>(responseSourcesSql(org))
    expect(sources.find(row => row.callbackId === callbackId && row.phase === 'attempt')?.startedAt.toISOString()).toBe(preference.at)
    await db.callbackCrmHandoff.update({ where: { callbackId }, data: { preferredTime: (await import('@prisma/client')).Prisma.DbNull } })
    const legacy = await db.$queryRaw<Array<{ callbackId: string; phase: string; startedAt: Date }>>(responseSourcesSql(org))
    expect(legacy.find(row => row.callbackId === callbackId && row.phase === 'attempt')?.startedAt.toISOString()).toBe(receipt.createdAt)
  })
  it('preserves timing and retry metadata across legacy-field writes and source deletion for rollback', async () => {
    await confirm()
    const session = await db.websiteReceptionistSession.create({ data: { organizationId: org, tokenHash: randomUUID(), ipHash: 'synthetic', siteOrigin: 'https://shop.example', configVersion: new Date(calendar.version), expiresAt: new Date(Date.now() + 1800000), callbackRequestHash: 'c'.repeat(64) } })
    sql(`UPDATE "WebsiteReceptionistCallback" SET status='reviewed' WHERE id='${callbackId}'; UPDATE "WebsiteReceptionistSession" SET closed=true WHERE id='${session.id}'`)
    expect((await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } })).preferredTime).toEqual(preference)
    expect((await db.websiteReceptionistSession.findUniqueOrThrow({ where: { id: session.id } })).callbackRequestHash).toBe('c'.repeat(64))
    await db.websiteReceptionistCallback.delete({ where: { id: callbackId } })
    expect((await db.callbackCrmHandoff.findUniqueOrThrow({ where: { callbackId } })).preferredTime).toEqual(preference)
    expect(await db.websiteReceptionistCallback.count({ where: { organizationId: control } })).toBe(1)
  })
  it('keeps legacy callbacks compatible and rejects foreign-organization actors', async () => {
    await expect(handoff.getCallbackHandoffOptions(org, outsider, callbackId)).rejects.toMatchObject({ statusCode: 403 })
    await db.websiteReceptionistCallback.update({ where: { id: callbackId }, data: { preferredTime: (await import('@prisma/client')).Prisma.DbNull } })
    const legacyDeadline = `${localDate}T09:00:00.000Z`, receipt = await confirm(legacyDeadline)
    expect(receipt.preferredTime).toBeUndefined(); expect((await db.task.findUniqueOrThrow({ where: { id: receipt.taskId } })).dueDate.toISOString()).toBe(legacyDeadline)
    expect(await db.websiteReceptionistCallback.count({ where: { organizationId: control } })).toBe(1)
  })
})
