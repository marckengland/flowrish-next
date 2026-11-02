import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { initialCallState, type ReceptionistConfig } from '../src/lib/receptionist'

// Only the external AI provider is replaced. Prisma, transactions, migration
// SQL, tenant filtering, and callback persistence run against real PostgreSQL.
const generate = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/ai', () => ({ generateReceptionistReply: generate }))

const container = `flowrish-receptionist-${process.pid}`
let db: PrismaClient
let handle: typeof import('../src/server/services/receptionist').handleReceptionistCall
let databaseStarted = false
const orgId = randomUUID()
const otherOrgId = randomUUID()
const userId = randomUUID()
let stageId: string
let config: ReceptionistConfig
const from = '+639181234567'

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
async function call(turn: number, callSid: string, speech = '', digits = '') {
  return handle(orgId, { callSid, from, turn, speech, digits, actionPath: `/api/voice/receptionist/${orgId}` })
}

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
  ;({ handleReceptionistCall: handle } = await import('../src/server/services/receptionist'))
  await db.organization.createMany({ data: [{ id: orgId, name: 'Receptionist verification', slug: `receptionist-${orgId}` }, { id: otherOrgId, name: 'Untouched workspace', slug: `receptionist-${otherOrgId}` }] })
  await db.user.create({ data: { id: userId, authId: randomUUID(), name: 'Test callback owner', email: `${userId}@example.invalid` } })
  await db.organizationMember.create({ data: { organizationId: orgId, userId } })
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: 'Verification pipeline', stages: { create: { name: 'New', order: 1 } } }, include: { stages: true } })
  stageId = pipeline.stages[0].id
  const otherPipeline = await db.pipeline.create({ data: { organizationId: otherOrgId, name: 'Control pipeline', stages: { create: { name: 'New', order: 1 } } }, include: { stages: true } })
  await db.lead.create({ data: { organizationId: otherOrgId, firstName: 'Control', lastName: 'Lead', phone: from, stageId: otherPipeline.stages[0].id } })
  config = { enabled: true, businessName: 'Verification business', knowledge: 'We repair bicycles.', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: userId, stageId }
  await db.receptionistConfig.create({ data: { organizationId: orgId, settings: config } })
})

afterAll(async () => {
  if (db) await db.$disconnect()
  if (databaseStarted) docker('stop', container)
})

describe('receptionist on disposable PostgreSQL', () => {
  it('runs the full migration history and blocks direct Data API roles', () => {
    expect(sql(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('ReceptionistConfig','ReceptionistCall') AND rowsecurity`)).toBe('2')
    expect(sql(`SELECT has_table_privilege('anon', '"ReceptionistCall"', 'SELECT'), has_table_privilege('authenticated', '"ReceptionistCall"', 'TRUNCATE')`)).toBe('f|f')
  })

  it('saves a confirmed call once under concurrent deliveries and never reuses another tenant lead', async () => {
    const sid = `CA${randomUUID().replaceAll('-', '')}`
    generate.mockResolvedValue({ fullName: 'Jane Smith', phone: from, reason: 'Please call about a bicycle repair.', reply: 'I can take a callback request.' })
    expect(await call(0, sid)).toContain('AI receptionist')
    expect(await call(1, sid, 'Jane Smith, please call about a bicycle repair.')).toContain('Is that correct?')
    expect(await db.task.count({ where: { organizationId: orgId } })).toBe(0)
    const responses = await Promise.all(Array.from({ length: 8 }, () => call(2, sid, 'yes')))
    expect(responses.every((response) => response.includes('has been saved'))).toBe(true)
    expect(await db.lead.count({ where: { organizationId: orgId } })).toBe(1)
    expect(await db.task.count({ where: { organizationId: orgId } })).toBe(1)
    expect(await db.activity.count({ where: { organizationId: orgId } })).toBe(1)
    expect(await db.auditEntry.count({ where: { organizationId: orgId } })).toBe(3)
    const task = await db.task.findFirstOrThrow({ where: { organizationId: orgId }, include: { lead: true } })
    expect(task.assigneeId).toBe(userId)
    expect(task.lead.organizationId).toBe(orgId)
    expect(await db.lead.count({ where: { organizationId: otherOrgId } })).toBe(1)
    expect(await db.activity.count({ where: { organizationId: otherOrgId } })).toBe(0)
  })

  it('rolls back the claimed turn and all CRM writes if callback persistence fails', async () => {
    const sid = `CA${randomUUID().replaceAll('-', '')}`
    const state = { ...initialCallState(from), fullName: 'Jane Smith', reason: 'Rollback verification', awaitingConfirmation: true }
    await db.receptionistCall.create({ data: { organizationId: orgId, callSid: sid, state, turn: 2 } })
    const before = await Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.auditEntry.count()])
    sql(`CREATE FUNCTION reject_verification_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic task write failure'; END $$; CREATE TRIGGER reject_verification_task BEFORE INSERT ON "Task" FOR EACH ROW EXECUTE FUNCTION reject_verification_task();`)
    try { await expect(call(2, sid, 'yes')).rejects.toThrow('Synthetic task write failure') }
    finally { sql('DROP TRIGGER reject_verification_task ON "Task"; DROP FUNCTION reject_verification_task();') }
    expect(await Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.auditEntry.count()])).toEqual(before)
    const stored = await db.receptionistCall.findUniqueOrThrow({ where: { organizationId_callSid: { organizationId: orgId, callSid: sid } } })
    expect(stored.turn).toBe(2)
    expect(stored.status).toBe('active')
  })

  it('can disable the feature twice without deleting call history or touching another workspace', async () => {
    const before = await Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.receptionistCall.count()])
    const { saveReceptionistConfig } = await import('../src/server/services/receptionist')
    await saveReceptionistConfig(orgId, { ...config, enabled: false })
    await saveReceptionistConfig(orgId, { ...config, enabled: false })
    expect(await call(0, `CA${randomUUID().replaceAll('-', '')}`)).toContain('not accepting')
    expect(await Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.receptionistCall.count()])).toEqual(before)
    expect(await db.lead.count({ where: { organizationId: otherOrgId } })).toBe(1)
  })
})
