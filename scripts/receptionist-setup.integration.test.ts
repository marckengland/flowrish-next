import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const container = `flowrish-setup-${randomUUID()}`, org = randomUUID(), other = randomUUID(), user = randomUUID(), outsider = randomUUID()
let db: PrismaClient, service: typeof import('../src/server/services/receptionist-setup'), started = false, docId: string, stageId: string
const values = { businessName: 'Synthetic Repairs', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5] }
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function snapshot() { return service.getReceptionistSetup(org, user) }
async function launch(version?: string) { return service.launchReceptionistSetup(org, user, { expectedVersion: version ?? (await snapshot()).version, acknowledged: true, simulationReviewed: true }) }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let n = 0; n < 100; n++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable database unavailable')
  const port = docker('port', container, '5432/tcp').split(':').at(-1); process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Provider transport forbidden') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); service = await import('../src/server/services/receptionist-setup')
  await db.organization.createMany({ data: [{ id: org, name: 'Setup Organization', slug: org }, { id: other, name: 'Other Organization', slug: other }] })
  for (const id of [user, outsider]) await db.user.create({ data: { id, authId: randomUUID(), name: 'Synthetic Admin', email: `${id}@example.invalid` } })
  await db.organizationMember.createMany({ data: [{ organizationId: org, userId: user }, { organizationId: other, userId: outsider }] })
  const role = await db.role.create({ data: { name: `SetupAdmin-${org}`, hierarchy: 3, permissions: { create: { key: 'admin:settings' } } } }), team = await db.team.create({ data: { organizationId: org, name: 'Setup Team' } }); await db.teamMember.create({ data: { userId: user, teamId: team.id, roleId: role.id } })
  const pipeline = await db.pipeline.create({ data: { organizationId: org, name: 'Callbacks', stages: { create: { name: 'New', order: 0 } } }, include: { stages: true } }); stageId = pipeline.stages[0].id
}, 60000)
beforeEach(async () => {
  await db.websiteReceptionistConfig.deleteMany(); await db.receptionistConfig.deleteMany(); await db.knowledgeDocument.deleteMany(); await db.aiProviderConfig.deleteMany()
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId: user, organizationId: org } }, create: { userId: user, organizationId: org }, update: {} })
  await db.receptionistConfig.create({ data: { organizationId: org, settings: { ...values, enabled: false, knowledge: 'PRIVATE PHONE NOTE', mode: 'always', forwardTo: '+12025550123', assigneeId: user, stageId } } })
  await db.websiteReceptionistConfig.create({ data: { organizationId: org, allowedOrigins: ['https://repairs.example.invalid'] } })
  await db.aiProviderConfig.create({ data: { organizationId: org, provider: 'openai', model: 'synthetic-model', apiKeyCiphertext: 'NOT_A_REAL_CIPHERTEXT' } })
  const doc = await db.knowledgeDocument.create({ data: { organizationId: org, title: 'Repair prices', category: 'PRICING', contentText: 'INTERNAL DRAFT', publishedTitle: 'Repair prices', publishedCategory: 'PRICING', publishedText: 'Repairs cost 500 pesos only after inspection approval.', publishedRevision: 1, publishedAt: new Date(), receptionistApprovedRevision: 1, createdById: user } }); docId = doc.id
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('guided setup reuses existing data without provider transport', () => {
  it('uses one complete real paragraph without joining or truncating its neighbors', async () => {
    await db.knowledgeDocument.update({ where: { id: docId }, data: { publishedText: `${'Oversized context. '.repeat(100)}\n\nA complete approved pricing paragraph, including the inspection condition.\n\nShort footer.` } })
    expect((await snapshot()).knowledge.sample?.text).toBe('A complete approved pricing paragraph, including the inspection condition.')
  })
  it('rejects conditional creation if legacy phone settings are created concurrently', async () => {
    await db.receptionistConfig.delete({ where: { organizationId: org } })
    await db.$executeRawUnsafe(`CREATE FUNCTION pause_setup_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.settings->>'businessName' = 'Setup Race' THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $$`)
    await db.$executeRawUnsafe(`CREATE TRIGGER pause_setup_insert BEFORE INSERT ON "ReceptionistConfig" FOR EACH ROW EXECUTE FUNCTION pause_setup_insert()`)
    try {
      const pending = service.saveReceptionistSetupBusiness(org, user, { values: { ...values, businessName: 'Setup Race' }, expectedUpdatedAt: null }).then(value => ({ value, error: null }), error => ({ value: null, error }))
      let paused = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await db.$queryRaw<Array<{ paused: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event='PgSleep' AND query LIKE '%ReceptionistConfig%') AS paused`
        if (rows[0].paused) { paused = true; break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(paused).toBe(true)
      const settings = { ...values, businessName: 'Legacy Phone', enabled: true, knowledge: 'PRIVATE PHONE NOTE', mode: 'always', forwardTo: '+12025550123', assigneeId: user, stageId }
      await db.receptionistConfig.create({ data: { organizationId: org, settings } })
      expect((await pending).error).toMatchObject({ statusCode: 409 })
      expect((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).toEqual(settings)
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER pause_setup_insert ON "ReceptionistConfig"`)
      await db.$executeRawUnsafe(`DROP FUNCTION pause_setup_insert()`)
    }
  })
  it('reads bounded approved public facts and metadata without writes or credential projections', async () => {
    const spy = vi.spyOn(db.aiProviderConfig, 'findUnique')
    try { const current = await snapshot(); expect(current.readyToEnable).toBe(true); expect(current.knowledge.sample?.text).toContain('only after inspection approval'); expect(JSON.stringify(current)).not.toContain('PRIVATE PHONE NOTE'); expect(JSON.stringify(current)).not.toContain('INTERNAL DRAFT'); expect(JSON.stringify(spy.mock.calls)).not.toContain('apiKeyCiphertext'); expect(current.website.settings?.enabled).toBe(false); expect(fetch).not.toHaveBeenCalled() } finally { spy.mockRestore() }
    expect(await db.lead.count()).toBe(0); expect(await db.task.count()).toBe(0); expect(await db.aiUsageDay.count()).toBe(0)
  })
  it('keeps unapproved/archived/other-org content out and never truncates pricing qualifiers', async () => {
    await db.knowledgeDocument.update({ where: { id: docId }, data: { publishedText: `Price is 5. ${'Long explanation. '.repeat(120)}Only after paid inspection approval.` } }); expect((await snapshot()).knowledge.sample).toBeNull()
    await db.knowledgeDocument.update({ where: { id: docId }, data: { receptionistApprovedRevision: null } }); const current = await snapshot(); expect(current.knowledge.approved).toBe(0); expect(current.readyToEnable).toBe(false); expect(current.knowledge.sample).toBeNull()
    await db.knowledgeDocument.create({ data: { organizationId: other, title: 'Private control', category: 'FAQ', contentText: 'Other organization secret', publishedText: 'Other organization secret', publishedRevision: 1, publishedAt: new Date(), receptionistApprovedRevision: 1, createdById: outsider } }); expect(JSON.stringify(await snapshot())).not.toContain('Other organization secret')
  })
  it('patches only the business subset and preserves live phone configuration', async () => {
    const original = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } }); const settings = { ...(original.settings as Record<string, unknown>), enabled: true, customOption: { keep: true } }; await db.receptionistConfig.update({ where: { organizationId: org }, data: { settings } })
    const current = await snapshot(); const next = await service.saveReceptionistSetupBusiness(org, user, { values: { ...values, businessName: 'Renamed Repairs' }, expectedUpdatedAt: current.business.updatedAt })
    const stored = (await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings as Record<string, unknown>
    expect(stored).toMatchObject({ enabled: true, knowledge: 'PRIVATE PHONE NOTE', forwardTo: '+12025550123', assigneeId: user, stageId, customOption: { keep: true }, businessName: 'Renamed Repairs' }); expect(next.business.phoneEnabled).toBe(true); expect(next.website.settings?.enabled).toBe(false); expect(fetch).not.toHaveBeenCalled()
  })
  it('serializes conditional business creation and never silently overwrites stale edits', async () => {
    await db.receptionistConfig.delete({ where: { organizationId: org } }); const before = await snapshot(); expect(before.business.saved).toBe(false)
    const input = { values, expectedUpdatedAt: null }; const results = await Promise.allSettled([service.saveReceptionistSetupBusiness(org, user, input), service.saveReceptionistSetupBusiness(org, user, input)])
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(await db.receptionistConfig.count()).toBe(1); const after = await snapshot(); expect(after.business.phoneEnabled).toBe(false)
    await expect(service.saveReceptionistSetupBusiness(org, user, input)).rejects.toMatchObject({ statusCode: 409 })
  })
  it('does not reset malformed existing configuration or accept unrelated settings', async () => {
    await expect(service.saveReceptionistSetupBusiness(org, user, { values: { ...values, enabled: true }, expectedUpdatedAt: (await snapshot()).business.updatedAt })).rejects.toBeDefined()
    await db.receptionistConfig.update({ where: { organizationId: org }, data: { settings: { unsupported: true } } }); await expect(snapshot()).rejects.toMatchObject({ statusCode: 409 }); expect((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).settings).toEqual({ unsupported: true })
  })
  it('enables only explicitly, preserves public identity and limits, and makes activation retries harmless', async () => {
    const before = await snapshot(), publicId = before.website.settings!.publicId
    await expect(service.launchReceptionistSetup(org, user, { expectedVersion: before.version, acknowledged: false, simulationReviewed: true })).rejects.toBeDefined()
    const after = await launch(before.version); expect(after.website.settings).toMatchObject({ publicId, enabled: true, allowedOrigins: before.website.settings!.allowedOrigins, dailyTokenLimit: before.website.settings!.dailyTokenLimit }); const updatedAt = after.website.settings!.updatedAt
    expect((await launch(before.version)).website.settings!.updatedAt).toBe(updatedAt); expect(await db.task.count()).toBe(0); expect(await db.activity.count()).toBe(0); expect(await db.aiUsageDay.count()).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects snapshots invalidated by business, website, Library or AI metadata changes', async () => {
    let current = await snapshot(); await db.receptionistConfig.update({ where: { organizationId: org }, data: { settings: { ...values, enabled: false, knowledge: 'private', mode: 'always', forwardTo: '', assigneeId: '', stageId: '', businessName: 'Changed' } } }); await expect(launch(current.version)).rejects.toMatchObject({ statusCode: 409 })
    current = await snapshot(); await db.websiteReceptionistConfig.update({ where: { organizationId: org }, data: { dailyMessageLimit: 6 } }); await expect(launch(current.version)).rejects.toMatchObject({ statusCode: 409 })
    current = await snapshot(); await db.knowledgeDocument.update({ where: { id: docId }, data: { revision: 2 } }); await expect(launch(current.version)).rejects.toMatchObject({ statusCode: 409 })
    current = await snapshot(); await db.aiProviderConfig.update({ where: { organizationId: org }, data: { dailyRequestLimit: 3 } }); await expect(launch(current.version)).rejects.toMatchObject({ statusCode: 409 }); expect((await snapshot()).website.settings!.enabled).toBe(false)
  })
  it('checks current readiness and organization permissions without provider fallback', async () => {
    await db.aiProviderConfig.update({ where: { organizationId: org }, data: { enabled: false } }); const current = await snapshot(); expect(current.readyToEnable).toBe(false); await expect(launch(current.version)).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.getReceptionistSetup(other, user)).rejects.toMatchObject({ statusCode: 403 }); await expect(service.getReceptionistSetup(org, outsider)).rejects.toMatchObject({ statusCode: 403 }); await db.organizationMember.delete({ where: { userId_organizationId: { userId: user, organizationId: org } } }); await expect(snapshot()).rejects.toMatchObject({ statusCode: 403 }); expect(fetch).not.toHaveBeenCalled()
  })
})
