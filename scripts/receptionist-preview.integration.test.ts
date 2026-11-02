import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const container = `flowrish-receptionist-preview-${process.pid}`
let db: PrismaClient
let service: typeof import('../src/server/services/receptionist-preview')
let knowledge: typeof import('../src/server/services/knowledge')
let databaseStarted = false
const orgId = randomUUID(), otherOrgId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID()
const generated = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/ai', () => ({ generateReceptionistReply: generated }))

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
const config = {
  enabled: false, businessName: 'Preview Bicycle Repairs', knowledge: 'We can take a callback request.', mode: 'always',
  timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: userId, stageId: '',
}
const extraction = { fullName: 'Preview Caller', phone: '+12025550123', reason: 'Synthetic callback request', reply: 'I can take your callback details.' }
async function counts() {
  return Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.receptionistCall.count(), db.auditEntry.count(), db.followUpSuggestion.count(), db.receptionistConfig.count()])
}

beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16')
  databaseStarted = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`
  process.env.DIRECT_URL = process.env.DATABASE_URL
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) {
    if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  }
  ;({ prisma: db } = await import('../src/server/db/client'))
  service = await import('../src/server/services/receptionist-preview')
  knowledge = await import('../src/server/services/knowledge')
  for (const [organizationId, actor] of [[orgId, userId], [otherOrgId, otherUserId]]) {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic preview workspace', slug: organizationId } })
    await db.user.create({ data: { id: actor, authId: randomUUID(), name: 'Preview administrator', email: `${actor}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId, userId: actor } })
    const role = await db.role.create({ data: { organizationId, name: 'Preview administrator', hierarchy: 1, permissions: { create: [{ key: 'admin:settings' }, { key: 'leads:read' }] } } })
    const team = await db.team.create({ data: { organizationId, name: 'Preview team' } })
    await db.teamMember.create({ data: { userId: actor, teamId: team.id, roleId: role.id } })
  }
  await db.receptionistConfig.create({ data: { organizationId: orgId, settings: config } })
  generated.mockResolvedValue(extraction)
})
afterAll(async () => { if (db) await db.$disconnect(); if (databaseStarted) docker('stop', container) })

async function approvedPrice(organizationId = orgId, actor = userId) {
  const draft = await knowledge.createKnowledge(organizationId, actor, { title: 'Bicycle repair prices', category: 'PRICING', contentText: organizationId === orgId ? 'Public bicycle repairs cost 500 pesos.' : 'Other workspace bicycle repairs cost 9999 pesos.' })
  const published = await knowledge.transitionKnowledge(organizationId, actor, draft.id, { action: 'publish', revision: draft.revision })
  return knowledge.transitionKnowledge(organizationId, actor, draft.id, { action: 'approve_receptionist', revision: published.revision, publishedRevision: published.publishedRevision!, acknowledged: true })
}

describe('receptionist preview on disposable PostgreSQL', () => {
  it('uses the saved business name while disabled, with no voice provider', async () => {
    const before = await counts()
    const saved = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: orgId } })
    const start = await service.previewReceptionist(orgId, userId, {})
    expect(start.reply).toContain(config.businessName)
    expect(start.finished).toBe(false)
    expect(start.callback).toBeNull()
    expect(start.settingsVersion).toBe(saved.updatedAt.toISOString())
    expect((await service.getReceptionistReadiness(orgId, userId)).voiceConfigured).toBe(false)
    expect(await counts()).toEqual(before)
    expect(await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: orgId } })).toEqual(saved)
  })

  it('confirms a callback summary without writing any CRM, call, audit or configuration record', async () => {
    const before = await counts()
    const saved = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: orgId } })
    const start = await service.previewReceptionist(orgId, userId, {})
    const turn = await service.previewReceptionist(orgId, userId, { state: start.state, settingsVersion: start.settingsVersion, speech: 'My name is Preview Caller. Please call me at +12025550123 about bicycle repairs.' })
    expect(turn.state.awaitingConfirmation).toBe(true)
    expect(turn.callback).toBeNull()
    const callsBeforeConfirmation = generated.mock.calls.length
    const finish = await service.previewReceptionist(orgId, userId, { state: turn.state, settingsVersion: turn.settingsVersion, digits: '1' })
    expect(finish.finished).toBe(true)
    expect(finish.callback).toEqual({ fullName: extraction.fullName, phone: extraction.phone, reason: extraction.reason })
    expect(finish.reply).toMatch(/preview/i)
    expect(finish.reply).toMatch(/nothing was saved/i)
    expect(generated.mock.calls).toHaveLength(callsBeforeConfirmation)
    expect(await counts()).toEqual(before)
    expect(await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: orgId } })).toEqual(saved)
  })

  it('retrieves only this workspace’s approved snapshot and drops it after revocation', async () => {
    const current = await approvedPrice()
    await approvedPrice(otherOrgId, otherUserId)
    await knowledge.createKnowledge(orgId, userId, { title: 'Bicycle repair private draft', category: 'PRICING', contentText: 'Private bicycle repair discount 123 pesos.' })
    const before = await counts()
    const ready = await service.getReceptionistReadiness(orgId, userId)
    expect(ready.approvedDocuments).toBe(1)
    const start = await service.previewReceptionist(orgId, userId, {})
    const answer = await service.previewReceptionist(orgId, userId, { state: start.state, settingsVersion: start.settingsVersion, speech: 'What are bicycle repair prices?' })
    expect(answer.sources.map(source => source.id)).toEqual([current.id])
    const providerConfig = generated.mock.calls.at(-1)![1]
    expect(providerConfig.knowledge).toContain('500 pesos')
    expect(providerConfig.knowledge).not.toContain('9999 pesos')
    expect(providerConfig.knowledge).not.toContain('123 pesos')
    expect(await counts()).toEqual(before)
    await knowledge.transitionKnowledge(orgId, userId, current.id, { action: 'revoke_receptionist', revision: current.revision })
    const afterRevoke = await counts()
    const fresh = await service.previewReceptionist(orgId, userId, {})
    const revoked = await service.previewReceptionist(orgId, userId, { state: fresh.state, settingsVersion: fresh.settingsVersion, speech: 'What are bicycle repair prices?' })
    expect(revoked.sources).toEqual([])
    expect(generated.mock.calls.at(-1)![1].knowledge).not.toContain('500 pesos')
    expect(await counts()).toEqual(afterRevoke)
  })

  it('denies an admin from another workspace who is only a reader in this one', async () => {
    await db.organizationMember.create({ data: { organizationId: otherOrgId, userId } })
    const role = await db.role.create({ data: { organizationId: otherOrgId, name: 'Read only', hierarchy: 3, permissions: { create: { key: 'leads:read' } } } })
    const team = await db.team.create({ data: { organizationId: otherOrgId, name: 'Reader team' } })
    await db.teamMember.create({ data: { userId, teamId: team.id, roleId: role.id } })
    await expect(service.getReceptionistReadiness(otherOrgId, userId)).rejects.toMatchObject({ statusCode: 403 })
    await expect(service.previewReceptionist(otherOrgId, userId, {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects a different workspace, missing saved configuration and stale settings', async () => {
    const start = await service.previewReceptionist(orgId, userId, {})
    await expect(service.previewReceptionist(otherOrgId, userId, {})).rejects.toThrow()
    await expect(service.previewReceptionist(otherOrgId, otherUserId, {})).rejects.toThrow(/save/i)
    await db.receptionistConfig.update({ where: { organizationId: orgId }, data: { settings: { ...config, businessName: 'Updated preview business' }, updatedAt: new Date(Date.now() + 5000) } })
    const before = await counts()
    await expect(service.previewReceptionist(orgId, userId, { state: start.state, settingsVersion: start.settingsVersion, speech: 'Hello' })).rejects.toThrow(/changed/i)
    expect(await counts()).toEqual(before)
  })
})
