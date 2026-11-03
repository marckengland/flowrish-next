import { execFileSync } from 'node:child_process'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { resolveCallbackTime } from '../src/lib/callback-time'
import { receptionistConfigSchema } from '../src/lib/receptionist'

const container = `flowrish-calendar-exceptions-${process.pid}`, org = randomUUID(), other = randomUUID(), user = randomUUID(), outsider = randomUUID()
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const localDate = day.toISOString().slice(0, 10), closed = { date: localDate, closed: true as const }
const config = { enabled: false, businessName: 'Sample Business', knowledge: 'PRIVATE NOTES', mode: 'always' as const, timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: '', stageId: '' }
const version = '2026-01-01T00:00:00.000Z', calendar = { timeZone: config.timeZone, opensAt: config.opensAt, closesAt: config.closesAt, businessDays: config.businessDays, version }
const preference = resolveCallbackTime({ localTime: `${localDate}T10:00`, timeZone: calendar.timeZone, businessVersion: version }, calendar)
let db: PrismaClient, setup: typeof import('../src/server/services/receptionist-setup'), settings: typeof import('../src/server/services/receptionist'), handoff: typeof import('../src/server/services/callback-handoff'), outcomes: typeof import('../src/server/services/callback-outcomes'), response: typeof import('../src/server/services/callback-response'), website: typeof import('../src/server/services/website-receptionist'), reconcile: typeof import('../src/server/services/callback-response-reconciliation'), stageId: string, leadId: string, callbackId: string, started = false
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw Error('Disposable database not ready')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubEnv('EMAIL_ENCRYPTION_KEY', 'b'.repeat(64))
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Provider transport forbidden') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); setup = await import('../src/server/services/receptionist-setup'); settings = await import('../src/server/services/receptionist'); handoff = await import('../src/server/services/callback-handoff'); outcomes = await import('../src/server/services/callback-outcomes'); response = await import('../src/server/services/callback-response'); website = await import('../src/server/services/website-receptionist'); reconcile = await import('../src/server/services/callback-response-reconciliation')
  await db.organization.createMany({ data: [{ id: org, name: 'Synthetic Business', slug: org }, { id: other, name: 'Untouched Business', slug: other }] })
  await db.user.createMany({ data: [{ id: user, authId: randomUUID(), name: 'Staff', email: `${user}@example.invalid` }, { id: outsider, authId: randomUUID(), name: 'Other staff', email: `${outsider}@example.invalid` }] })
  await db.organizationMember.createMany({ data: [{ userId: user, organizationId: org }, { userId: outsider, organizationId: other }] })
  const role = await db.role.create({ data: { name: `Calendar-${org}`, hierarchy: 3, permissions: { create: ['admin:settings', 'leads:read', 'leads:write', 'contacts:read'].map(key => ({ key })) } } })
  const team = await db.team.create({ data: { name: 'Calendar team', organizationId: org } }); await db.teamMember.create({ data: { userId: user, teamId: team.id, roleId: role.id } })
  const pipeline = await db.pipeline.create({ data: { name: 'Sales', organizationId: org, stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); stageId = pipeline.stages[0].id
  await db.receptionistConfig.create({ data: { organizationId: other, settings: { ...config, businessName: 'Untouched Business', calendarExceptions: [closed] } } })
})
beforeEach(async () => {
  await db.callbackResponseTarget.deleteMany({ where: { organizationId: org } }); await db.callbackResponsePolicy.deleteMany({ where: { organizationId: org } }); await db.callbackOutcomeEvent.deleteMany({ where: { organizationId: org } }); await db.callbackCrmHandoff.deleteMany({ where: { organizationId: org } }); await db.websiteReceptionistCallback.deleteMany({ where: { organizationId: org } }); await db.task.deleteMany({ where: { organizationId: org } }); await db.lead.deleteMany({ where: { organizationId: org } })
  await db.receptionistConfig.upsert({ where: { organizationId: org }, create: { organizationId: org, settings: config, updatedAt: new Date(version) }, update: { settings: config, updatedAt: new Date(version) } })
  callbackId = (await db.websiteReceptionistCallback.create({ data: { organizationId: org, sourceSessionId: randomUUID(), fullName: 'Sample Visitor', phone: '+12025550123', reason: 'Services', siteOrigin: 'https://shop.example', preferredTime: preference } })).id
  leadId = (await db.lead.create({ data: { organizationId: org, firstName: 'Sample', lastName: 'Visitor', phone: '+12025550123', stageId } })).id
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); if (started) docker('stop', container) })
async function save(calendarExceptions: object[], actor = user) {
  const current = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })
  const { timeZone, opensAt, closesAt, businessDays } = calendar
  return setup.saveReceptionistSetupBusiness(org, actor, { expectedUpdatedAt: current.updatedAt.toISOString(), values: { businessName: config.businessName, timeZone, opensAt, closesAt, businessDays, calendarExceptions } })
}
async function draft() { return { expectedUpdatedAt: (await db.websiteReceptionistCallback.findUniqueOrThrow({ where: { id: callbackId } })).updatedAt.toISOString(), target: { mode: 'lead' as const, leadId }, assigneeId: user, dueDate: preference.at, acknowledgeDuplicate: false } }
async function confirm() { const value = await draft(), preview = await handoff.previewCallbackHandoff(org, user, callbackId, value); return handoff.commitCallbackHandoff(org, user, callbackId, { draft: value, previewVersion: preview.version, confirmed: true }) }

describe('business calendar exceptions with real disposable PostgreSQL', () => {
  it('blocks the documented full rollback when cleared exception keys remain stored', async () => {
    const query = readFileSync('docs/ops/business-calendar-exceptions-rollback.md', 'utf8').match(/\x60\x60\x60sql\n([\s\S]*?)\n\x60\x60\x60/)?.[1]
    expect(query).toBeDefined()
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "ReceptionistConfig" (settings jsonb) ON COMMIT DROP')
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "CallbackResponsePolicy" (hours jsonb) ON COMMIT DROP')
      await tx.$executeRaw`INSERT INTO "ReceptionistConfig" VALUES (${JSON.stringify({ ...config, calendarExceptions: [] })}::jsonb)`
      await tx.$executeRaw`INSERT INTO "CallbackResponsePolicy" VALUES (${JSON.stringify({ ...calendar, calendarExceptions: [] })}::jsonb)`
      const [row] = await tx.$queryRawUnsafe<Array<{ business_calendars: bigint; policy_calendars: bigint }>>(query!)
      expect(Number(row.business_calendars)).toBe(1); expect(Number(row.policy_calendars)).toBe(1)
    })
  })
  it('roundtrips exceptions and preserves private settings, disabled reception and other tenants', async () => {
    const result = await save([closed]); expect(result.business.values).toMatchObject({ calendarExceptions: [closed] }); expect(JSON.stringify(result.business.values)).not.toContain('PRIVATE NOTES')
    expect((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).toMatchObject({ knowledge: 'PRIVATE NOTES', enabled: false, calendarExceptions: [closed] })
    expect((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: other } })).settings).toMatchObject({ businessName: 'Untouched Business', calendarExceptions: [closed] })
    expect(await db.task.count({ where: { organizationId: org } })).toBe(0)
  })
  it('retains saved exceptions when legacy setup and settings clients omit them, and clears only explicitly', async () => {
    await save([closed]); const current = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })
    const { timeZone, opensAt, closesAt, businessDays } = calendar
    expect((await setup.saveReceptionistSetupBusiness(org, user, { expectedUpdatedAt: current.updatedAt.toISOString(), values: { businessName: 'Edited business', timeZone, opensAt, closesAt, businessDays } })).business.values).toMatchObject({ calendarExceptions: [closed] })
    expect(await settings.saveReceptionistConfig(org, { ...config, businessName: 'Legacy settings save' })).toMatchObject({ calendarExceptions: [closed] })
    expect(receptionistConfigSchema.parse((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).calendarExceptions).toEqual([closed])
    expect((await save([])).business.values.calendarExceptions).toEqual([])
  })
  it('retains a concurrent calendar edit when an older settings client omits exceptions', async () => {
    let release!: () => void, locked!: (pid: number) => void
    const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<number>(resolve => { locked = resolve })
    const writer = db.$transaction(async tx => {
      await tx.receptionistConfig.update({ where: { organizationId: org }, data: { settings: { ...config, calendarExceptions: [closed] } } })
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`; locked(row.pid); await gate
    }, { timeout: 10000 })
    const writerPid = await ready
    let settled = false, blocked = false
    const operation = settings.saveReceptionistConfig(org, { ...config, businessName: 'Older client edit' }).then(value => ({ value, error: null }), error => ({ value: null, error })).finally(() => { settled = true })
    try {
      for (let attempt = 0; attempt < 100 && !settled && !blocked; attempt++) {
        const [row] = await db.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${writerPid}::integer = ANY(pg_blocking_pids(pid))) AS blocked`
        blocked = row.blocked; if (!blocked && !settled) await new Promise(resolve => setTimeout(resolve, 10))
      }
    } finally { release(); await writer }
    const result = await operation
    expect(blocked).toBe(true); expect(result.error).toBe(null); expect(result.value).toMatchObject({ businessName: 'Older client edit', calendarExceptions: [closed] })
    expect(receptionistConfigSchema.parse((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).calendarExceptions).toEqual([closed])
  })
  it('requires current organization authorization and rejects stale saves', async () => {
    await expect(save([closed], outsider)).rejects.toMatchObject({ statusCode: 403 })
    const current = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } }); await save([closed])
    await expect(setup.saveReceptionistSetupBusiness(org, user, { expectedUpdatedAt: current.updatedAt.toISOString(), values: { businessName: config.businessName, timeZone: config.timeZone, opensAt: config.opensAt, closesAt: config.closesAt, businessDays: config.businessDays, calendarExceptions: [] } })).rejects.toMatchObject({ statusCode: 409 })
    expect(receptionistConfigSchema.parse((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).calendarExceptions).toEqual([closed])
  })
  it('flags a pending request when its date closes and invalidates the earlier staff approval', async () => {
    const value = await draft(), preview = await handoff.previewCallbackHandoff(org, user, callbackId, value)
    await save([closed])
    expect((await handoff.getCallbackHandoffOptions(org, user, callbackId)).callback).toMatchObject({ preferredTime: preference, calendarReviewRequired: true })
    expect((await website.listWebsiteCallbacks(org, user, { status: 'pending' })).callbacks[0]).toMatchObject({ calendarReviewRequired: true })
    await expect(handoff.commitCallbackHandoff(org, user, callbackId, { draft: value, previewVersion: preview.version, confirmed: true })).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.task.count({ where: { organizationId: org } })).toBe(0)
  })
  it('retains the original confirmed task, flags a removed source and clears warning after reviewed rescheduling', async () => {
    const receipt = await confirm(); await db.websiteReceptionistCallback.delete({ where: { id: callbackId } }); await save([closed])
    const detail = await outcomes.getCallbackOutcome(org, user, callbackId, {})
    expect(detail).toMatchObject({ source: null, preferredTime: preference, calendarReviewRequired: true, task: { dueDate: preference.at } })
    const next = new Date(preference.at); next.setUTCDate(next.getUTCDate() + 1)
    const input = { expectedVersion: detail.version, draft: { outcome: 'retry', action: 'reschedule', notes: 'Staff confirmed the next open day', assigneeId: user, dueDate: next.toISOString() } }
    const preview = await outcomes.previewCallbackOutcome(org, user, callbackId, input)
    await outcomes.recordCallbackOutcome(org, user, callbackId, { ...input, requestId: randomUUID(), previewVersion: preview.version, confirmed: true })
    const updated = await outcomes.getCallbackOutcome(org, user, callbackId, {})
    expect(updated.calendarReviewRequired).not.toBe(true); expect(updated.preferredTime).toEqual(preference)
    expect((await db.task.findUniqueOrThrow({ where: { id: receipt.taskId } })).dueDate.toISOString()).toBe(next.toISOString())
  })
  it('tracks the current task in inbox warnings and excludes completed work', async () => {
    const receipt = await confirm(); await save([closed])
    expect((await website.listWebsiteCallbacks(org, user, { status: 'pending' })).callbacks[0].calendarReviewRequired).toBe(true)
    const detail = await outcomes.getCallbackOutcome(org, user, callbackId, {}), next = new Date(preference.at); next.setUTCDate(next.getUTCDate() + 1)
    const input = { expectedVersion: detail.version, draft: { outcome: 'retry', action: 'reschedule', notes: 'Staff confirmed a valid replacement', assigneeId: user, dueDate: next.toISOString() } }, reviewed = await outcomes.previewCallbackOutcome(org, user, callbackId, input)
    await outcomes.recordCallbackOutcome(org, user, callbackId, { ...input, requestId: randomUUID(), previewVersion: reviewed.version, confirmed: true })
    expect((await website.listWebsiteCallbacks(org, user, { status: 'pending' })).callbacks[0].calendarReviewRequired).not.toBe(true)
    await save([closed, { date: next.toISOString().slice(0, 10), closed: true }])
    expect((await website.listWebsiteCallbacks(org, user, { status: 'pending' })).callbacks[0].calendarReviewRequired).toBe(true)
    await db.task.update({ where: { id: receipt.taskId }, data: { isComplete: true } })
    expect((await website.listWebsiteCallbacks(org, user, { status: 'pending' })).callbacks[0].calendarReviewRequired).not.toBe(true)
    expect((await outcomes.getCallbackOutcome(org, user, callbackId, {})).calendarReviewRequired).not.toBe(true)
  })
  it('rejects a closed public callback before quota consumption and accepts a newly reviewed open date', async () => {
    await save([closed])
    const profile = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })
    const websiteConfig = await db.websiteReceptionistConfig.upsert({ where: { organizationId: org }, create: { organizationId: org, enabled: true, allowedOrigins: ['https://shop.example'] }, update: { enabled: true } })
    const token = 'c'.repeat(64), createdAt = new Date(Date.now() - 5000), dayUtc = new Date(createdAt); dayUtc.setUTCHours(0, 0, 0, 0)
    const hash = createHmac('sha256', Buffer.from('b'.repeat(64), 'hex')).update([org, dayUtc.toISOString(), '127.0.0.1'].join('\n')).digest('hex')
    await db.websiteReceptionistSession.create({ data: { organizationId: org, tokenHash: createHash('sha256').update(token).digest('hex'), ipHash: hash, siteOrigin: 'https://shop.example', configVersion: websiteConfig.updatedAt, createdAt, expiresAt: new Date(Date.now() + 1800000) } })
    const input = { fullName: 'New Sample Visitor', phone: '+12025550124', reason: 'Sample request', confirmed: true, website: '', preferredTime: { localTime: preference.localTime, timeZone: calendar.timeZone, businessVersion: profile.updatedAt.toISOString() } }
    const context = { ip: '127.0.0.1', origin: 'https://app.example' }
    await expect(website.submitWebsiteCallback(websiteConfig.publicId, token, input, context)).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.websiteReceptionistUsage.count({ where: { organizationId: org } })).toBe(0)
    expect(await db.websiteReceptionistCallback.count({ where: { organizationId: org } })).toBe(1)
    const next = new Date(preference.at); next.setUTCDate(next.getUTCDate() + 1)
    const changed = { ...input, preferredTime: { ...input.preferredTime, localTime: next.toISOString().slice(0, 10) + 'T10:00' } }
    expect(await website.submitWebsiteCallback(websiteConfig.publicId, token, changed, context)).toEqual({ received: true })
    expect((await db.websiteReceptionistUsage.findFirstOrThrow({ where: { organizationId: org } })).callbacks).toBe(1)
  })
  it('adopts exceptions for response deadlines only after explicit policy approval', async () => {
    await db.websiteReceptionistCallback.update({ where: { id: callbackId }, data: { createdAt: new Date(`${localDate}T01:00:00Z`) } })
    const input = { enabled: true, handoffMinutes: 60, attemptMinutes: 120, backupUserId: user, expectedUpdatedAt: null, expectedBusinessUpdatedAt: version, acknowledged: true }
    await response.saveCallbackResponsePolicy(org, user, input); await reconcile.reconcileCallbackResponseTargets(org)
    const before = await db.callbackResponseTarget.findFirstOrThrow({ where: { organizationId: org, callbackId, phase: 'handoff' } }); expect(before.dueAt.toISOString()).toBe(`${localDate}T02:00:00.000Z`)
    await save([closed]); const metadata = await response.getCallbackResponsePolicy(org, user)
    expect(metadata.hoursChanged).toBe(true); expect(metadata.business.hours).toMatchObject({ calendarExceptions: [closed] }); expect(metadata.policy.hours?.calendarExceptions).toBeUndefined()
    await reconcile.reconcileCallbackResponseTargets(org); expect((await db.callbackResponseTarget.findFirstOrThrow({ where: { organizationId: org, callbackId, phase: 'handoff' } })).dueAt).toEqual(before.dueAt)
    await expect(response.saveCallbackResponsePolicy(org, user, { ...input, expectedUpdatedAt: metadata.policy.updatedAt, expectedBusinessUpdatedAt: metadata.business.updatedAt, acknowledged: false })).rejects.toBeDefined()
    await response.saveCallbackResponsePolicy(org, user, { ...input, expectedUpdatedAt: metadata.policy.updatedAt, expectedBusinessUpdatedAt: metadata.business.updatedAt }); await reconcile.reconcileCallbackResponseTargets(org)
    const nextDay = new Date(`${localDate}T02:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    expect((await db.callbackResponseTarget.findFirstOrThrow({ where: { organizationId: org, callbackId, phase: 'handoff' } })).dueAt.toISOString()).toBe(nextDay.toISOString())
    expect(await db.task.count({ where: { organizationId: org } })).toBe(0)
  })
})
