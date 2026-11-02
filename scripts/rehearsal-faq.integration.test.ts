import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const container = `flowrish-faq-${process.pid}`
let db: PrismaClient, faq: typeof import('../src/server/services/rehearsal-faq'), reports: typeof import('../src/server/services/receptionist-rehearsals'), knowledge: typeof import('../src/server/services/knowledge')
let started = false, reportId: string, version: string, documentId: string
const orgId = randomUUID(), otherOrgId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID()
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
const snapshot = { clientId: randomUUID(), settingsVersion: '2026-11-02T00:00:00.000Z', finished: false, messages: [
  { role: 'receptionist', content: 'Hello from the synthetic business.', sources: [], generation: 'scripted' },
  { role: 'caller', content: 'What are your Sunday opening hours?', sources: [], generation: 'scripted' },
  { role: 'receptionist', content: 'Untrusted neighboring response must not be copied.', sources: [], generation: 'ai' },
  { role: 'caller', content: 'Do you provide weekend bicycle rentals?', sources: [], generation: 'scripted' },
] }
beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Live transport disabled')))
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16')
  started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`
  process.env.DIRECT_URL = process.env.DATABASE_URL
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client'))
  faq = await import('../src/server/services/rehearsal-faq')
  reports = await import('../src/server/services/receptionist-rehearsals')
  knowledge = await import('../src/server/services/knowledge')
  for (const [organizationId, actor] of [[orgId, userId], [otherOrgId, otherUserId]]) {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic FAQ workspace', slug: organizationId } })
    await db.user.create({ data: { id: actor, authId: randomUUID(), name: 'FAQ administrator', email: `${actor}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId, userId: actor } })
    const role = await db.role.create({ data: { organizationId, name: 'FAQ admin', hierarchy: 1, permissions: { create: [{ key: 'admin:settings' }] } } })
    const team = await db.team.create({ data: { organizationId, name: 'FAQ team' } })
    await db.teamMember.create({ data: { userId: actor, teamId: team.id, roleId: role.id } })
  }
  const report = await reports.createRehearsal(orgId, userId, { title: 'Sunday hours test', snapshot })
  const reviewed = await reports.reviewRehearsal(orgId, userId, report.id, { expectedUpdatedAt: report.updatedAt, verdict: 'needs_work', notes: 'Private review note must stay out of public answers.', unansweredMessageIndexes: [1, 3] })
  reportId = report.id; version = reviewed.updatedAt
})
afterAll(async () => { if (db) await db.$disconnect(); if (started) docker('stop', container); vi.unstubAllGlobals() })

describe('flagged questions to FAQ drafts on disposable PostgreSQL', () => {
  it('keeps link metadata private to server code', () => {
    expect(sql('SELECT relrowsecurity FROM pg_class WHERE oid=\'"RehearsalFaqDraft"\'::regclass')).toBe('t')
    for (const role of ['anon', 'authenticated']) for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(sql(`SELECT has_table_privilege('${role}', '"RehearsalFaqDraft"', '${permission}')`)).toBe('f')
  })
  it('creates one private FAQ for concurrent retries and preserves the original report review', async () => {
    const before = await Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.receptionistCall.count()])
    const results = await Promise.all([faq.createRehearsalFaq(orgId, userId, reportId, { messageIndex: 1, expectedUpdatedAt: version }), faq.createRehearsalFaq(orgId, userId, reportId, { messageIndex: 1, expectedUpdatedAt: version })])
    expect(results[0].documentId).toBe(results[1].documentId)
    expect(results.filter(value => value.created)).toHaveLength(1)
    documentId = results[0].documentId
    const document = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } })
    expect(document).toMatchObject({ category: 'FAQ', revision: 1, publishedAt: null, publishedRevision: null, receptionistApprovedRevision: null, contentText: 'Question: What are your Sunday opening hours?\n\nAnswer:\n' })
    expect(await db.knowledgeChunk.count({ where: { documentId } })).toBe(0)
    expect(await db.auditEntry.count({ where: { entityId: documentId, action: 'CREATE' } })).toBe(1)
    expect((await reports.getRehearsal(orgId, userId, reportId))).toMatchObject({ verdict: 'needs_work', unansweredMessageIndexes: [1, 3], updatedAt: version })
    expect((await knowledge.getReceptionistKnowledge(orgId, 'Sunday opening hours')).sources).toHaveLength(0)
    expect((await knowledge.getAirishKnowledge(orgId, userId, 'Sunday opening hours')).sources).toHaveLength(0)
    expect(await Promise.all([db.lead.count(), db.task.count(), db.activity.count(), db.receptionistCall.count()])).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('keeps origin outside text through editing, publication and separate receptionist approval', async () => {
    const edited = await knowledge.updateKnowledge(orgId, userId, documentId, { revision: 1, title: 'Sunday opening hours', category: 'FAQ', contentText: 'Question: What are your Sunday opening hours?\n\nAnswer: We open Sundays from 10 AM to 2 PM.' })
    expect(await faq.getRehearsalFaqOrigin(orgId, userId, documentId)).toMatchObject({ rehearsalId: reportId, messageIndex: 1, title: 'Sunday hours test' })
    const published = await knowledge.transitionKnowledge(orgId, userId, documentId, { action: 'publish', revision: edited.revision })
    expect((await knowledge.getReceptionistKnowledge(orgId, 'Sunday opening hours')).sources).toHaveLength(0)
    await knowledge.transitionKnowledge(orgId, userId, documentId, { action: 'approve_receptionist', revision: published.revision, publishedRevision: published.publishedRevision!, acknowledged: true })
    const publicKnowledge = await knowledge.getReceptionistKnowledge(orgId, 'Sunday opening hours')
    expect(publicKnowledge.text).toContain('10 AM to 2 PM')
    expect(publicKnowledge.text).not.toContain('Private review note')
    expect(publicKnowledge.text).not.toContain('/settings')
  })
  it('rejects stale, unflagged, cross-org and former-member requests', async () => {
    await expect(faq.createRehearsalFaq(orgId, userId, reportId, { messageIndex: 1, expectedUpdatedAt: '2020-01-01T00:00:00Z' })).rejects.toMatchObject({ statusCode: 409 })
    await expect(faq.createRehearsalFaq(orgId, userId, reportId, { messageIndex: 0, expectedUpdatedAt: version })).rejects.toMatchObject({ statusCode: 400 })
    await expect(faq.createRehearsalFaq(otherOrgId, otherUserId, reportId, { messageIndex: 1, expectedUpdatedAt: version })).rejects.toMatchObject({ statusCode: 404 })
    await expect(faq.getRehearsalFaqOrigin(otherOrgId, otherUserId, documentId)).rejects.toMatchObject({ statusCode: 404 })
    await db.organizationMember.delete({ where: { userId_organizationId: { organizationId: otherOrgId, userId: otherUserId } } })
    await expect(faq.createRehearsalFaq(otherOrgId, otherUserId, reportId, { messageIndex: 1, expectedUpdatedAt: version })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('enforces tenant boundaries in foreign keys even outside the service', async () => {
    const otherReport = await db.receptionistRehearsal.create({ data: { organizationId: otherOrgId, createdById: otherUserId, clientId: randomUUID(), title: 'Other workspace fixture', snapshot } })
    const ownDocument = await db.knowledgeDocument.create({ data: { organizationId: orgId, createdById: userId, title: 'Temporary own FAQ', category: 'FAQ', contentText: 'Synthetic temporary fixture.' } })
    const otherDocument = await db.knowledgeDocument.create({ data: { organizationId: otherOrgId, createdById: otherUserId, title: 'Temporary other FAQ', category: 'FAQ', contentText: 'Synthetic temporary fixture.' } })
    await expect(db.rehearsalFaqDraft.create({ data: { organizationId: orgId, rehearsalId: otherReport.id, messageIndex: 3, documentId: ownDocument.id } })).rejects.toMatchObject({ code: 'P2003' })
    await expect(db.rehearsalFaqDraft.create({ data: { organizationId: orgId, rehearsalId: reportId, messageIndex: 3, documentId: otherDocument.id } })).rejects.toMatchObject({ code: 'P2003' })
    await db.knowledgeDocument.deleteMany({ where: { id: { in: [ownDocument.id, otherDocument.id] } } })
    expect(await db.rehearsalFaqDraft.count()).toBe(1)
  })
  it('enforces the shared active-document limit while allowing existing links to reopen', async () => {
    await db.knowledgeDocument.createMany({ data: Array.from({ length: 49 }, (_, index) => ({ organizationId: orgId, createdById: userId, title: `Synthetic unpublished filler ${index}`, category: 'GENERAL', contentText: 'Synthetic private fixture.' })) })
    expect((await faq.createRehearsalFaq(orgId, userId, reportId, { messageIndex: 1, expectedUpdatedAt: version })).created).toBe(false)
    await expect(faq.createRehearsalFaq(orgId, userId, reportId, { messageIndex: 3, expectedUpdatedAt: version })).rejects.toMatchObject({ code: 'KNOWLEDGE_LIMIT' })
    expect(await db.rehearsalFaqDraft.count({ where: { organizationId: orgId } })).toBe(1)
  })
  it('retains the FAQ when its rehearsal is deleted and removes only the internal link', async () => {
    await reports.deleteRehearsal(orgId, userId, reportId)
    expect(await db.knowledgeDocument.count({ where: { id: documentId } })).toBe(1)
    expect(await faq.getRehearsalFaqOrigin(orgId, userId, documentId)).toBeNull()
    expect(await db.rehearsalFaqDraft.count()).toBe(0)
  })
})
