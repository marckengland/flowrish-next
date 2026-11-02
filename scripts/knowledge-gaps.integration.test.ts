import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import type { PrismaClient } from '@prisma/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { gapDetailSchema, gapListSchema } from '../src/lib/knowledge-gaps'

const container = `flowrish-gaps-${process.pid}`
const orgId = randomUUID(), otherOrgId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID()
const question = 'What are your Sunday opening hours?'
let db: PrismaClient
let gaps: typeof import('../src/server/services/knowledge-gaps')
let reports: typeof import('../src/server/services/receptionist-rehearsals')
let faq: typeof import('../src/server/services/rehearsal-faq')
let knowledge: typeof import('../src/server/services/knowledge')
let started = false

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

async function flagged(text = question, organizationId = orgId, actor = userId) {
  const report = await reports.createRehearsal(organizationId, actor, {
    title: 'Synthetic saved rehearsal',
    snapshot: {
      clientId: randomUUID(), settingsVersion: '2026-11-03T00:00:00.000Z', finished: false,
      messages: [
        { role: 'receptionist', content: 'Untrusted neighboring answer must remain private.', sources: [], generation: 'scripted' },
        { role: 'caller', content: text, sources: [], generation: 'scripted' },
      ],
    },
  })
  return reports.reviewRehearsal(organizationId, actor, report.id, {
    expectedUpdatedAt: report.updatedAt, verdict: 'needs_work', notes: 'Private report review note.', unansweredMessageIndexes: [1],
  })
}

async function onlyGroup(organizationId = orgId, actor = userId) {
  const result = await gaps.getKnowledgeGapList(organizationId, actor, { status: 'all' })
  expect(result.groups).toHaveLength(1)
  return result.groups[0]
}

async function unrelatedState() {
  const [leads, tasks, activities, calls, providers, budgets, prompts, settings] = await Promise.all([
    db.lead.findMany(), db.task.findMany(), db.activity.findMany(), db.receptionistCall.findMany(),
    db.aiProviderConfig.findMany(), db.aiUsageDay.findMany(), db.aiPromptConfig.findMany(), db.receptionistConfig.findMany(),
  ])
  return { leads, tasks, activities, calls, providers, budgets, prompts, settings }
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Live transport forbidden in disposable knowledge gap tests.')))
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16')
  started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break }
    catch { await new Promise(resolve => setTimeout(resolve, 100)) }
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
  gaps = await import('../src/server/services/knowledge-gaps')
  reports = await import('../src/server/services/receptionist-rehearsals')
  faq = await import('../src/server/services/rehearsal-faq')
  knowledge = await import('../src/server/services/knowledge')
  for (const [organizationId, actor] of [[orgId, userId], [otherOrgId, otherUserId]]) {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic gap workspace', slug: organizationId } })
    await db.user.create({ data: { id: actor, authId: randomUUID(), name: 'Synthetic administrator', email: `${actor}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId, userId: actor } })
    const role = await db.role.create({ data: { organizationId, name: 'Gap admin', hierarchy: 1, permissions: { create: [{ key: 'admin:settings' }] } } })
    const team = await db.team.create({ data: { organizationId, name: 'Gap team' } })
    await db.teamMember.create({ data: { userId: actor, teamId: team.id, roleId: role.id } })
  }
  await db.receptionistConfig.create({ data: { organizationId: orgId, settings: { greeting: 'Synthetic unchanged greeting' } } })
  await db.aiUsageDay.create({ data: { organizationId: orgId, day: new Date('2026-11-03'), requests: 7, reportedTokens: 123 } })
})

beforeEach(async () => {
  await db.receptionistRehearsal.deleteMany()
  await db.knowledgeDocument.deleteMany()
  await db.$executeRaw`DELETE FROM "KnowledgeGapReview"`
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId, organizationId: orgId } }, create: { userId, organizationId: orgId }, update: {} })
  const role = await db.role.findFirstOrThrow({ where: { organizationId: orgId } })
  await db.rolePermission.upsert({ where: { roleId_key: { roleId: role.id, key: 'admin:settings' } }, create: { roleId: role.id, key: 'admin:settings' }, update: {} })
  vi.mocked(fetch).mockClear()
})

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
})

afterAll(async () => {
  if (db) await db.$disconnect()
  if (started) docker('stop', container)
  vi.unstubAllGlobals()
})

describe('saved knowledge gaps on disposable PostgreSQL', () => {
  it('keeps review rows private with RLS and revoked browser-role privileges', () => {
    expect(sql('SELECT relrowsecurity FROM pg_class WHERE oid=\'"KnowledgeGapReview"\'::regclass')).toBe('t')
    for (const role of ['anon', 'authenticated']) {
      for (const permission of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(sql(`SELECT has_table_privilege('${role}', '"KnowledgeGapReview"', '${permission}')`)).toBe('f')
      }
    }
    expect(sql('SELECT count(*) FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault(\'r\', c.relowner))) a WHERE c.oid=\'"KnowledgeGapReview"\'::regclass AND a.grantee=0')).toBe('0')
  })

  it('groups case and whitespace across history beyond 25 without merging different wording or malformed flags', async () => {
    const variants = [question, '  WHAT are your Sunday opening HOURS?  ', 'What\tare your\nSunday opening hours?']
    for (let index = 0; index < 27; index++) await flagged(variants[index % 3])
    await flagged('When do you open on Sundays?')
    const malformed = await flagged('Temporary malformed fixture')
    await db.receptionistRehearsal.update({ where: { id: malformed.id }, data: {
      snapshot: { messages: [{ role: 'receptionist', content: question }, { role: 'caller', content: ' \t\n ' }, { role: 'caller', content: 42 }] },
      unansweredMessageIndexes: [0, 1, 2, 99],
    } })
    const list = gapListSchema.parse(await gaps.getKnowledgeGapList(orgId, userId, { status: 'all' }))
    expect(list.groups).toHaveLength(2)
    expect(list.groups.map(group => group.occurrenceCount).sort((a, b) => a - b)).toEqual([1, 27])
    const repeated = list.groups.find(group => group.occurrenceCount === 27)!
    const detail = gapDetailSchema.parse(await gaps.getKnowledgeGapDetail(orgId, userId, repeated.key, {}))
    expect(detail).toMatchObject({ page: 1, pageSize: 20, hasMore: true })
    expect(detail.occurrences).toHaveLength(20)
    expect(detail.occurrences.every(value => value.faq === null)).toBe(true)
    expect(JSON.stringify({ list, detail })).not.toContain('Untrusted neighboring answer')
    expect(JSON.stringify({ list, detail })).not.toContain('Private report review note')
  })

  it('paginates groups and occurrences without duplicates and handles empty later pages', async () => {
    for (let index = 0; index < 21; index++) await flagged()
    for (let index = 0; index < 21; index++) await flagged(`Distinct saved caller question ${index}?`)
    const first = await gaps.getKnowledgeGapList(orgId, userId, { status: 'all', page: 1 })
    const second = await gaps.getKnowledgeGapList(orgId, userId, { status: 'all', page: 2 })
    expect(first).toMatchObject({ page: 1, pageSize: 20, hasMore: true })
    expect(second).toMatchObject({ page: 2, pageSize: 20, hasMore: false })
    expect(first.groups).toHaveLength(20)
    expect(second.groups).toHaveLength(2)
    expect(new Set([...first.groups, ...second.groups].map(value => value.key)).size).toBe(22)
    const group = [...first.groups, ...second.groups].find(value => value.occurrenceCount === 21)!
    const detail1 = await gaps.getKnowledgeGapDetail(orgId, userId, group.key, { page: 1 })
    const detail2 = await gaps.getKnowledgeGapDetail(orgId, userId, group.key, { page: 2 })
    expect(detail1).toMatchObject({ pageSize: 20, hasMore: true })
    expect(detail2).toMatchObject({ page: 2, pageSize: 20, hasMore: false })
    expect(detail1.occurrences).toHaveLength(20)
    expect(detail2.occurrences).toHaveLength(1)
    expect(new Set([...detail1.occurrences, ...detail2.occurrences].map(value => value.rehearsalId)).size).toBe(21)
    expect(await gaps.getKnowledgeGapList(orgId, userId, { page: 10000 })).toMatchObject({ groups: [], hasMore: false })
    expect(await gaps.getKnowledgeGapDetail(orgId, userId, group.key, { page: 10000 })).toMatchObject({ occurrences: [], hasMore: false })
  })

  it('checks tenant membership and effective admin permission freshly for every operation', async () => {
    await flagged()
    const group = await onlyGroup()
    const actions = (organizationId: string, actor: string) => [
      () => gaps.getKnowledgeGapDetail(organizationId, actor, group.key, {}),
      () => gaps.reviewKnowledgeGap(organizationId, actor, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: '' }),
      () => gaps.createKnowledgeGapFaq(organizationId, actor, group.key, { expectedVersion: group.version }),
    ]
    expect((await gaps.getKnowledgeGapList(otherOrgId, otherUserId, {})).groups).toEqual([])
    for (const action of actions(otherOrgId, otherUserId)) await expect(action()).rejects.toMatchObject({ statusCode: 404 })
    await db.organizationMember.delete({ where: { userId_organizationId: { userId, organizationId: orgId } } })
    for (const action of [() => gaps.getKnowledgeGapList(orgId, userId, {}), ...actions(orgId, userId)]) await expect(action()).rejects.toMatchObject({ statusCode: 403 })
    await db.organizationMember.create({ data: { userId, organizationId: orgId } })
    const role = await db.role.findFirstOrThrow({ where: { organizationId: orgId } })
    await db.rolePermission.deleteMany({ where: { roleId: role.id } })
    for (const action of [() => gaps.getKnowledgeGapList(orgId, userId, {}), ...actions(orgId, userId)]) await expect(action()).rejects.toMatchObject({ statusCode: 403 })
  })

  it('shows source-only, draft, published, approved and archived occurrences without publishing drafts', async () => {
    await flagged()
    const documentIds: string[] = []
    for (const status of ['draft', 'published', 'approved', 'archived']) {
      const report = await flagged()
      const result = await faq.createRehearsalFaq(orgId, userId, report.id, { messageIndex: 1, expectedUpdatedAt: report.updatedAt })
      documentIds.push(result.documentId)
      if (status !== 'draft') {
        const document = await knowledge.transitionKnowledge(orgId, userId, result.documentId, { action: status === 'archived' ? 'archive' : 'publish', revision: 1 })
        if (status === 'approved') await knowledge.transitionKnowledge(orgId, userId, result.documentId, { action: 'approve_receptionist', revision: document.revision, publishedRevision: document.publishedRevision!, acknowledged: true })
      }
    }
    const group = await onlyGroup()
    expect(group).toMatchObject({ occurrenceCount: 5, faqCounts: { draft: 1, published: 1, approved: 1, archived: 1 }, status: 'open' })
    const detail = gapDetailSchema.parse(await gaps.getKnowledgeGapDetail(orgId, userId, group.key, {}))
    expect(detail.occurrences.filter(value => value.faq === null)).toHaveLength(1)
    expect(detail.occurrences.flatMap(value => value.faq ? [value.faq.status] : []).sort()).toEqual(['approved', 'archived', 'draft', 'published'])
    expect(new Set(detail.occurrences.flatMap(value => value.faq ? [value.faq.documentId] : []))).toEqual(new Set(documentIds))
    expect(await db.knowledgeChunk.count({ where: { documentId: documentIds[0] } })).toBe(0)
    const reused = await gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: group.version })
    expect(reused.created).toBe(false)
    expect(documentIds.slice(0, 3)).toContain(reused.documentId)
    expect(await db.knowledgeDocument.count()).toBe(4)
  })

  it('requires a manual retest to resolve, filters resolved groups, and reopens without editing sources or budgets', async () => {
    const report = await flagged()
    const group = await onlyGroup()
    const before = { unrelated: await unrelatedState(), report: await db.receptionistRehearsal.findUniqueOrThrow({ where: { id: report.id } }), documents: await db.knowledgeDocument.findMany() }
    await expect(gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: false, notes: '' })).rejects.toBeDefined()
    expect((await onlyGroup()).status).toBe('open')
    await gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: 'Manually retested the revised answer.' })
    const resolved = await onlyGroup()
    expect(resolved).toMatchObject({ status: 'resolved', changedSinceResolution: false, resolution: { notes: 'Manually retested the revised answer.' } })
    expect(resolved.resolution?.resolvedAt).toEqual(expect.any(String))
    expect((await gaps.getKnowledgeGapList(orgId, userId, {})).groups).toEqual([])
    expect((await gaps.getKnowledgeGapList(orgId, userId, { status: 'resolved' })).groups).toHaveLength(1)
    await gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: resolved.version, action: 'reopen', retested: false, notes: 'Needs another check.' })
    expect(await onlyGroup()).toMatchObject({ status: 'open', changedSinceResolution: false })
    expect({ unrelated: await unrelatedState(), report: await db.receptionistRehearsal.findUniqueOrThrow({ where: { id: report.id } }), documents: await db.knowledgeDocument.findMany() }).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('invalidates resolution when a new flag or linked FAQ edit changes the saved evidence', async () => {
    await flagged()
    let group = await onlyGroup()
    await expect(gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 409 })
    const created = await gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: group.version })
    group = await onlyGroup()
    await gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: 'Checked.' })
    const resolved = await onlyGroup()
    await flagged(' WHAT ARE YOUR SUNDAY OPENING HOURS? ')
    group = await onlyGroup()
    expect(group).toMatchObject({ status: 'open', changedSinceResolution: true, occurrenceCount: 2 })
    await expect(gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: resolved.version, action: 'resolve', retested: true, notes: 'Stale.' })).rejects.toMatchObject({ statusCode: 409 })
    const savedDocument = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: created.documentId } })
    const savedAuditCount = await db.auditEntry.count({ where: { entityId: created.documentId } })
    expect(await gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: resolved.version })).toEqual({ ...created, created: false })
    expect(await db.knowledgeDocument.findUniqueOrThrow({ where: { id: created.documentId } })).toEqual(savedDocument)
    expect(await db.auditEntry.count({ where: { entityId: created.documentId } })).toBe(savedAuditCount)
    expect(await db.knowledgeDocument.count()).toBe(1)
    await gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: 'Retested again.' })
    await knowledge.updateKnowledge(orgId, userId, created.documentId, { revision: 1, title: 'Updated Sunday FAQ', category: 'FAQ', contentText: 'Question: Sunday hours?\n\nAnswer: Synthetic saved answer.' })
    expect(await onlyGroup()).toMatchObject({ status: 'open', changedSinceResolution: true })
  })

  it('allows only one concurrent review of the same version and rejects a later stale overwrite', async () => {
    await flagged()
    const group = await onlyGroup()
    const results = await Promise.allSettled(['First reviewer note.', 'Second reviewer note.'].map(notes => gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes })))
    expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(value => value.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409 })
    const resolved = await onlyGroup()
    expect(resolved.status).toBe('resolved')
    expect(['First reviewer note.', 'Second reviewer note.']).toContain(resolved.resolution?.notes)
    await expect(gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'reopen', retested: false, notes: 'Overwrite.' })).rejects.toMatchObject({ statusCode: 409 })
    expect((await onlyGroup()).version).toBe(resolved.version)
  })

  it('serializes repeated-question FAQ creation and reuses an existing public FAQ unchanged', async () => {
    const oldest = await flagged()
    await flagged(' WHAT are your Sunday opening hours? ')
    const group = await onlyGroup()
    const before = await unrelatedState()
    const results = await Promise.allSettled([1, 2].map(() => gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: group.version })))
    const successful = results.filter(value => value.status === 'fulfilled').map(value => (value as PromiseFulfilledResult<Awaited<ReturnType<typeof gaps.createKnowledgeGapFaq>>>).value)
    expect(successful.length).toBeGreaterThanOrEqual(1)
    expect(successful.filter(value => value.created)).toHaveLength(1)
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ statusCode: 409 })
    expect(await db.knowledgeDocument.count()).toBe(1)
    expect(await db.rehearsalFaqDraft.count()).toBe(1)
    const link = await db.rehearsalFaqDraft.findFirstOrThrow()
    expect(link.rehearsalId).toBe(oldest.id)
    const documentId = successful[0].documentId
    const published = await knowledge.transitionKnowledge(orgId, userId, documentId, { action: 'publish', revision: 1 })
    await knowledge.transitionKnowledge(orgId, userId, documentId, { action: 'approve_receptionist', revision: published.revision, publishedRevision: published.publishedRevision!, acknowledged: true })
    const savedDocument = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } })
    const savedReports = await db.receptionistRehearsal.findMany({ orderBy: { id: 'asc' } })
    const current = await onlyGroup()
    const reopened = await Promise.all([1, 2].map(() => gaps.createKnowledgeGapFaq(orgId, userId, current.key, { expectedVersion: current.version })))
    expect(reopened).toEqual([1, 2].map(() => ({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: false })))
    expect(await db.knowledgeDocument.findUniqueOrThrow({ where: { id: documentId } })).toEqual(savedDocument)
    expect(await db.receptionistRehearsal.findMany({ orderBy: { id: 'asc' } })).toEqual(savedReports)
    expect(await unrelatedState()).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('finishes publication while a concurrent resolver waits for the FAQ row and rejects its stale evidence', async () => {
    await flagged()
    let group = await onlyGroup()
    const created = await gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: group.version })
    group = await onlyGroup()
    const waitForLock = async (locktype: string) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        const [result] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND l.locktype=${locktype} AND NOT l.granted) AS waiting`
        if (result.waiting) return
      }
      throw new Error(`Expected a blocked ${locktype} lock before the five-second deadline.`)
    }
    await db.$executeRawUnsafe('CREATE FUNCTION gap_test_pause_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(7031103); RETURN NEW; END $$')
    await db.$executeRawUnsafe('CREATE TRIGGER gap_test_pause_publish BEFORE UPDATE ON "KnowledgeDocument" FOR EACH ROW EXECUTE FUNCTION gap_test_pause_publish()')
    let publication: Promise<PromiseSettledResult<unknown>> | undefined
    let review: Promise<PromiseSettledResult<unknown>> | undefined
    const settled = <T,>(promise: Promise<T>): Promise<PromiseSettledResult<T>> => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))
    try {
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7031103)`
        publication = settled(knowledge.transitionKnowledge(orgId, userId, created.documentId, { action: 'publish', revision: 1 }))
        await waitForLock('advisory')
        review = settled(gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: 'Concurrently retested.' }))
        await waitForLock('transactionid')
      }, { timeout: 10000 })
      const [published, reviewed] = await Promise.all([publication!, review!])
      expect(published.status).toBe('fulfilled')
      expect(reviewed).toMatchObject({ status: 'rejected', reason: { statusCode: 409 } })
      expect(await onlyGroup()).toMatchObject({ status: 'open', resolution: null, faqCounts: { published: 1 } })
    } finally {
      await Promise.all([publication, review])
      await db.$executeRawUnsafe('DROP TRIGGER gap_test_pause_publish ON "KnowledgeDocument"')
      await db.$executeRawUnsafe('DROP FUNCTION gap_test_pause_publish()')
    }
  })

  it('removes unflagged and deleted occurrences and returns 404 after the last source disappears', async () => {
    const first = await flagged()
    const second = await flagged()
    const group = await onlyGroup()
    await gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: 'Retested.' })
    await reports.reviewRehearsal(orgId, userId, first.id, { expectedUpdatedAt: first.updatedAt, verdict: 'passed', notes: '', unansweredMessageIndexes: [] })
    expect(await onlyGroup()).toMatchObject({ occurrenceCount: 1, status: 'open', changedSinceResolution: true })
    await reports.deleteRehearsal(orgId, userId, second.id)
    expect((await gaps.getKnowledgeGapList(orgId, userId, { status: 'all' })).groups).toEqual([])
    expect(sql('SELECT count(*) FROM "KnowledgeGapReview"')).toBe('1')
    await expect(gaps.getKnowledgeGapDetail(orgId, userId, group.key, {})).rejects.toMatchObject({ statusCode: 404 })
    await expect(gaps.reviewKnowledgeGap(orgId, userId, group.key, { expectedVersion: group.version, action: 'resolve', retested: true, notes: '' })).rejects.toMatchObject({ statusCode: 404 })
    await expect(gaps.createKnowledgeGapFaq(orgId, userId, group.key, { expectedVersion: group.version })).rejects.toMatchObject({ statusCode: 404 })
  })
})
