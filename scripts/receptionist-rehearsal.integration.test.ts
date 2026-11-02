import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const container = `flowrish-rehearsal-${process.pid}`
let db: PrismaClient
let service: typeof import('../src/server/services/receptionist-rehearsals')
let started = false
const orgId = randomUUID(), otherOrgId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID()
const snapshot = { clientId: randomUUID(), settingsVersion: '2026-11-02T00:00:00.000Z', finished: false, messages: [
  { role: 'receptionist', content: 'Hello from a synthetic business.', sources: [], generation: 'scripted' },
  { role: 'caller', content: 'What does an unlisted service cost?', sources: [], generation: 'scripted' },
  { role: 'receptionist', content: 'I can take a callback request.', sources: [{ id: randomUUID(), title: 'Published sample FAQ', revision: 2 }], generation: 'ai' },
] }
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function crmCounts() { return Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.receptionistCall.count(), db.auditEntry.count(), db.receptionistConfig.count()]) }
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Live transport disabled')))
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16')
  started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`
  process.env.DIRECT_URL = process.env.DATABASE_URL
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client'))
  service = await import('../src/server/services/receptionist-rehearsals')
  for (const [organizationId, actor] of [[orgId, userId], [otherOrgId, otherUserId]]) {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic rehearsal workspace', slug: organizationId } })
    await db.user.create({ data: { id: actor, authId: randomUUID(), name: 'Rehearsal administrator', email: `${actor}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId, userId: actor } })
    const role = await db.role.create({ data: { organizationId, name: 'Rehearsal admin', hierarchy: 1, permissions: { create: [{ key: 'admin:settings' }] } } })
    const team = await db.team.create({ data: { organizationId, name: 'Rehearsal team' } })
    await db.teamMember.create({ data: { userId: actor, teamId: team.id, roleId: role.id } })
  }
})
afterAll(async () => { if (db) await db.$disconnect(); if (started) docker('stop', container); vi.unstubAllGlobals() })

describe('saved rehearsals on disposable PostgreSQL', () => {
  it('adds a private report table with RLS and no anonymous or authenticated Data API grants', () => {
    expect(sql('SELECT relrowsecurity FROM pg_class WHERE oid=\'"ReceptionistRehearsal"\'::regclass')).toBe('t')
    for (const role of ['anon', 'authenticated']) for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(sql(`SELECT has_table_privilege('${role}', '"ReceptionistRehearsal"', '${permission}')`)).toBe('f')
  })
  it('saves retry-safe concurrent snapshots, tenant-scopes history and leaves CRM data unchanged', async () => {
    const before = await crmCounts()
    const saved = await Promise.all([service.createRehearsal(orgId, userId, { title: 'Unanswered question', snapshot }), service.createRehearsal(orgId, userId, { title: 'Unanswered question', snapshot })])
    expect(saved[0].id).toBe(saved[1].id)
    expect(await db.receptionistRehearsal.count({ where: { organizationId: orgId } })).toBe(1)
    const other = await service.createRehearsal(otherOrgId, otherUserId, { title: 'Other workspace', snapshot })
    expect(other.id).not.toBe(saved[0].id)
    expect((await service.listRehearsals(orgId, userId)).map(report => report.id)).toEqual([saved[0].id])
    await expect(service.getRehearsal(otherOrgId, otherUserId, saved[0].id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await crmCounts()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves sources, supports human review and caller gaps, and prevents stale or cross-tenant writes', async () => {
    const [saved] = await service.listRehearsals(orgId, userId)
    const review = { expectedUpdatedAt: saved.updatedAt, verdict: 'needs_work', notes: 'Add the unlisted service to approved FAQs.', unansweredMessageIndexes: [1] }
    const updated = await service.reviewRehearsal(orgId, userId, saved.id, review)
    expect(updated.snapshot).toEqual(snapshot)
    expect(updated.verdict).toBe('needs_work')
    expect(updated.unansweredMessageIndexes).toEqual([1])
    await expect(service.reviewRehearsal(orgId, userId, saved.id, review)).rejects.toMatchObject({ statusCode: 409 })
    await expect(service.reviewRehearsal(otherOrgId, otherUserId, saved.id, { ...review, expectedUpdatedAt: updated.updatedAt })).rejects.toMatchObject({ statusCode: 404 })
    await expect(service.deleteRehearsal(otherOrgId, otherUserId, saved.id)).rejects.toMatchObject({ statusCode: 404 })
    expect((await service.getRehearsal(orgId, userId, saved.id)).verdict).toBe('needs_work')
  })
  it('rejects former members and removes only the chosen rehearsal', async () => {
    const [saved] = await service.listRehearsals(otherOrgId, otherUserId)
    await db.organizationMember.delete({ where: { userId_organizationId: { organizationId: otherOrgId, userId: otherUserId } } })
    await expect(service.getRehearsal(otherOrgId, otherUserId, saved.id)).rejects.toMatchObject({ statusCode: 403 })
    const [own] = await service.listRehearsals(orgId, userId)
    await service.deleteRehearsal(orgId, userId, own.id)
    expect(await db.receptionistRehearsal.count({ where: { organizationId: orgId } })).toBe(0)
    expect(await db.receptionistRehearsal.count({ where: { organizationId: otherOrgId } })).toBe(1)
  })
})
