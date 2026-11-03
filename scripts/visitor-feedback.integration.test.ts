import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const generation = vi.hoisted(() => vi.fn())
vi.mock('../src/server/services/website-receptionist-generation', () => ({ generateWebsiteReceptionistAnswer: generation }))
const container = `flowrish-feedback-test-${randomUUID()}`, org = randomUUID(), other = randomUUID(), admin = randomUUID(), staff = randomUUID(), foreign = randomUUID()
const context = { ip: '192.0.2.1', origin: 'https://app.example.invalid' }, siteOrigin = 'https://business.example.invalid'
let db: PrismaClient, website: typeof import('../src/server/services/website-receptionist'), service: typeof import('../src/server/services/visitor-feedback'), publicId: string, started = false
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false; for (let i = 0; i < 100; i++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }; if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1); process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL; process.env.EMAIL_ENCRYPTION_KEY = 'ab'.repeat(32)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live provider transport forbidden') })); sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  ;({ prisma: db } = await import('../src/server/db/client')); website = await import('../src/server/services/website-receptionist'); service = await import('../src/server/services/visitor-feedback')
  await db.organization.createMany({ data: [{ id: org, name: 'Synthetic Repairs', slug: `feedback-${org}` }, { id: other, name: 'Control', slug: `feedback-${other}` }] })
  for (const id of [admin, staff, foreign]) { await db.user.create({ data: { id, authId: randomUUID(), email: `${id}@example.invalid`, name: 'Synthetic Member' } }); await db.organizationMember.create({ data: { userId: id, organizationId: org } }) }
  const role = await db.role.create({ data: { name: `FeedbackAdmin-${org}`, hierarchy: 3, permissions: { create: { key: 'admin:settings' } } } })
  for (const [organizationId, userId] of [[org, admin], [other, foreign]]) { const team = await db.team.create({ data: { organizationId, name: 'Synthetic team' } }); await db.teamMember.create({ data: { teamId: team.id, userId, roleId: role.id } }) }
  await db.receptionistConfig.create({ data: { organizationId: org, settings: { enabled: false, businessName: 'Synthetic Repairs', knowledge: '', mode: 'always', timeZone: 'UTC', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' } } })
  await db.aiProviderConfig.create({ data: { organizationId: org, provider: 'deepseek', model: 'deepseek-flash', apiKeyCiphertext: 'INVALID NOT A REAL KEY' } })
}, 60000)
beforeEach(async () => {
  generation.mockReset().mockResolvedValue('Please request a callback for a repair estimate.')
  await db.websiteReceptionistFeedback.deleteMany(); await db.websiteReceptionistFeedbackUsage.deleteMany(); await db.knowledgeDocument.deleteMany(); await db.websiteReceptionistSession.deleteMany(); await db.websiteReceptionistUsage.deleteMany(); await db.websiteReceptionistConfig.deleteMany()
  await db.organizationMember.upsert({ where: { userId_organizationId: { userId: admin, organizationId: org } }, create: { userId: admin, organizationId: org }, update: {} })
  const config = await db.websiteReceptionistConfig.create({ data: { organizationId: org, enabled: true, allowedOrigins: [siteOrigin], dailyMessageLimit: 20, dailyTokenLimit: 200000 } }); publicId = config.publicId
  await db.knowledgeDocument.create({ data: { organizationId: org, createdById: admin, title: 'Services', category: 'SERVICES', contentText: 'Bicycle repairs.', publishedAt: new Date(), publishedRevision: 1, publishedText: 'Bicycle repairs.', receptionistApprovedRevision: 1 } })
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
async function enable() { const policy = await service.getVisitorFeedbackPolicy(org, admin); return service.saveVisitorFeedbackPolicy(org, admin, { enabled: true, acknowledged: true, expectedUpdatedAt: policy.updatedAt }) }
async function answered() {
  const session = await website.startWebsiteSession(publicId, { siteOrigin, website: '' }, context); await db.websiteReceptionistSession.update({ where: { tokenHash: createHash('sha256').update(session.token).digest('hex') }, data: { createdAt: new Date(Date.now() - 3000) } })
  const requestId = randomUUID(); await website.sendWebsiteMessage(publicId, session.token, { requestId, expectedTurn: 0, question: 'Can you repair bicycles?', history: [], website: '' }, context)
  return { session, input: { requestId, question: 'Can you repair bicycles?', consented: true, website: '' } }
}
async function saved() { await enable(); const value = await answered(); await website.submitWebsiteFeedback(publicId, value.session.token, value.input, context); return db.websiteReceptionistFeedback.findFirstOrThrow({ where: { organizationId: org } }) }
describe('visitor feedback privacy and FAQ transactions on disposable PostgreSQL', () => {
  it('keeps defaults off and the new table private without retaining asked questions', async () => {
    expect((await db.websiteReceptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).feedbackEnabled).toBe(false)
    expect(sql('SELECT relrowsecurity FROM pg_class WHERE relname=\'WebsiteReceptionistFeedback\'')).toBe('t')
    for (const role of ['anon', 'authenticated']) for (const table of ['WebsiteReceptionistFeedback', 'WebsiteReceptionistFeedbackUsage']) expect(sql(`SELECT has_table_privilege('${role}', '"${table}"', 'SELECT,INSERT,UPDATE,DELETE')`)).toBe('f')
    const { session, input } = await answered(); expect(session).not.toHaveProperty('feedbackEnabled'); await expect(website.submitWebsiteFeedback(publicId, session.token, input, context)).rejects.toMatchObject({ statusCode: 403 }); expect(await db.websiteReceptionistFeedback.count()).toBe(0)
  })
  it('requires local Settings membership, explicit acknowledgement and current policy version without enabling the widget', async () => {
    for (const user of [staff, foreign]) await expect(service.getVisitorFeedbackPolicy(org, user)).rejects.toMatchObject({ statusCode: 403 })
    const policy = await service.getVisitorFeedbackPolicy(org, admin)
    await expect(service.saveVisitorFeedbackPolicy(org, admin, { enabled: true, acknowledged: false, expectedUpdatedAt: policy.updatedAt })).rejects.toBeDefined()
    await db.websiteReceptionistConfig.update({ where: { organizationId: org }, data: { enabled: false } }); const next = await service.getVisitorFeedbackPolicy(org, admin)
    await service.saveVisitorFeedbackPolicy(org, admin, { enabled: true, acknowledged: true, expectedUpdatedAt: next.updatedAt }); expect((await db.websiteReceptionistConfig.findUniqueOrThrow({ where: { organizationId: org } })).enabled).toBe(false)
    await expect(service.saveVisitorFeedbackPolicy(org, admin, { enabled: false, acknowledged: false, expectedUpdatedAt: policy.updatedAt })).rejects.toMatchObject({ statusCode: 409 })
    await db.organizationMember.delete({ where: { userId_organizationId: { userId: admin, organizationId: org } } }); await expect(service.getVisitorFeedbackList(org, admin, {})).rejects.toMatchObject({ statusCode: 403 })
  })
  it('saves only reviewed question text and server consent metadata; repeated saves are idempotent and changed retries conflict', async () => {
    await enable(); const { session, input } = await answered(); expect(session.feedbackEnabled).toBe(true); const usage = await db.websiteReceptionistUsage.findMany()
    await expect(website.submitWebsiteFeedback(publicId, session.token, { ...input, consented: false }, context)).rejects.toBeDefined()
    const results = await Promise.all(Array.from({ length: 4 }, () => website.submitWebsiteFeedback(publicId, session.token, input, context))); expect(results).toEqual(Array(4).fill({ received: true })); expect(await db.websiteReceptionistFeedback.count()).toBe(1)
    await expect(website.submitWebsiteFeedback(publicId, session.token, { ...input, question: 'Changed retry' }, context)).rejects.toMatchObject({ statusCode: 409 })
    const row = await db.websiteReceptionistFeedback.findFirstOrThrow(); expect(row.question).toBe(input.question); expect(row.siteOrigin).toBe(siteOrigin); expect(JSON.stringify(row)).not.toMatch(/token|ipHash|reply|transcript|phone|apiKey/); expect(await db.websiteReceptionistUsage.findMany()).toEqual(usage); expect(generation).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects wrong IP/org/origin, forged/stale IDs, in-flight answers, expired sessions and a disabled policy', async () => {
    await enable(); const { session, input } = await answered()
    await expect(website.submitWebsiteFeedback(publicId, session.token, input, { ...context, ip: '192.0.2.2' })).rejects.toMatchObject({ statusCode: 403 })
    const { publicWebsiteResponse } = await import('../src/server/services/website-receptionist-http')
    const badOrigin = new Request(`${context.origin}/api/public/website-receptionist/${publicId}/feedback`, { method: 'POST', headers: { origin: 'https://evil.invalid', authorization: `Bearer ${session.token}`, 'x-forwarded-for': context.ip }, body: JSON.stringify(input) })
    expect((await publicWebsiteResponse(badOrigin, true, (body, requestContext, token) => website.submitWebsiteFeedback(publicId, token, body, requestContext))).status).toBe(403)
    const control = await db.websiteReceptionistConfig.create({ data: { organizationId: other, enabled: true, feedbackEnabled: true, allowedOrigins: [siteOrigin] } }); await expect(website.submitWebsiteFeedback(control.publicId, session.token, input, context)).rejects.toMatchObject({ statusCode: 403 })
    await expect(website.submitWebsiteFeedback(publicId, session.token, { ...input, requestId: randomUUID() }, context)).rejects.toMatchObject({ statusCode: 409 })
    const where = { tokenHash: createHash('sha256').update(session.token).digest('hex') }; await db.websiteReceptionistSession.update({ where, data: { inFlightId: randomUUID() } }); await expect(website.submitWebsiteFeedback(publicId, session.token, input, context)).rejects.toMatchObject({ statusCode: 409 })
    await db.websiteReceptionistSession.update({ where, data: { inFlightId: null, expiresAt: new Date(Date.now() - 1) } }); await expect(website.submitWebsiteFeedback(publicId, session.token, input, context)).rejects.toMatchObject({ statusCode: 410 }); expect(await db.websiteReceptionistFeedback.count()).toBe(0)
  })
  it('expires active chats when feedback policy changes and preserves the flag across ordinary website saves', async () => {
    await enable(); const { session, input } = await answered(); const policy = await service.getVisitorFeedbackPolicy(org, admin)
    await service.saveVisitorFeedbackPolicy(org, admin, { enabled: false, acknowledged: false, expectedUpdatedAt: policy.updatedAt }); await expect(website.submitWebsiteFeedback(publicId, session.token, input, context)).rejects.toBeDefined()
    await enable(); const { publicId: _publicId, updatedAt, ...config } = (await website.getWebsiteReceptionistAdmin(org, admin)).settings!; await website.saveWebsiteReceptionist(org, admin, { ...config, expectedUpdatedAt: updatedAt, acknowledged: true }); expect((await service.getVisitorFeedbackPolicy(org, admin)).enabled).toBe(true)
  })
  it('enforces the organization daily cap atomically while allowing same-body retries', async () => {
    await enable(); const { session, input } = await answered(); const day = new Date(); day.setUTCHours(0, 0, 0, 0)
    await db.websiteReceptionistFeedback.createMany({ data: Array.from({ length: 50 }, () => ({ organizationId: org, sourceSessionId: randomUUID(), requestId: randomUUID(), question: 'Synthetic prior question', siteOrigin, consentedAt: day })) })
    await db.websiteReceptionistFeedbackUsage.create({ data: { organizationId: org, day, reports: 50 } })
    await expect(website.submitWebsiteFeedback(publicId, session.token, input, context)).rejects.toMatchObject({ statusCode: 429 }); expect(await db.websiteReceptionistFeedback.count()).toBe(50)
  })
  it('paginates only current-organization retained reports and rejects foreign record actions', async () => {
    await db.websiteReceptionistFeedback.createMany({ data: Array.from({ length: 25 }, () => ({ organizationId: org, sourceSessionId: randomUUID(), requestId: randomUUID(), question: 'Synthetic visitor report', siteOrigin, consentedAt: new Date() })) })
    const hidden = await db.websiteReceptionistFeedback.create({ data: { organizationId: other, sourceSessionId: randomUUID(), requestId: randomUUID(), question: 'CONTROL PRIVATE', siteOrigin, consentedAt: new Date() } })
    const first = await service.getVisitorFeedbackList(org, admin, {}), second = await service.getVisitorFeedbackList(org, admin, { page: 2 }); expect(first.rows).toHaveLength(20); expect(first.hasMore).toBe(true); expect(second.rows).toHaveLength(5); expect(JSON.stringify(first)).not.toContain('CONTROL PRIVATE'); await expect(service.changeVisitorFeedback(org, admin, hidden.id, { action: 'dismiss', expectedUpdatedAt: hidden.updatedAt.toISOString() })).rejects.toMatchObject({ statusCode: 404 })
  })
  it('serializes the last daily slot across distinct concurrent answered sessions', async () => {
    await enable(); const a = await answered(), b = await answered()
    await db.websiteReceptionistFeedback.createMany({ data: Array.from({ length: 49 }, () => ({ organizationId: org, sourceSessionId: randomUUID(), requestId: randomUUID(), question: 'Synthetic question', siteOrigin, consentedAt: new Date() })) })
    await db.websiteReceptionistFeedbackUsage.create({ data: { organizationId: org, day: new Date(new Date().toISOString().slice(0, 10)), reports: 49 } })
    const results = await Promise.allSettled([a, b].map(value => website.submitWebsiteFeedback(publicId, value.session.token, value.input, context))); expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(results.filter(value => value.status === 'rejected')).toHaveLength(1); expect(await db.websiteReceptionistFeedback.count()).toBe(50)
  })
  it('keeps an opaque session receipt so a deleted question cannot reappear on a public retry', async () => {
    await enable(); const { session, input } = await answered(); await website.submitWebsiteFeedback(publicId, session.token, input, context); const record = await db.websiteReceptionistFeedback.findFirstOrThrow()
    await service.changeVisitorFeedback(org, admin, record.id, { action: 'delete', expectedUpdatedAt: record.updatedAt.toISOString() }); expect(await db.websiteReceptionistFeedback.count()).toBe(0); expect(await website.submitWebsiteFeedback(publicId, session.token, input, context)).toEqual({ received: true }); expect(await db.websiteReceptionistFeedback.count()).toBe(0)
  })
  it('does not restore the daily issuance allowance when an administrator deletes a report', async () => {
    await enable(); await db.websiteReceptionistFeedback.createMany({ data: Array.from({ length: 49 }, () => ({ organizationId: org, sourceSessionId: randomUUID(), requestId: randomUUID(), question: 'Synthetic issued feedback', siteOrigin, consentedAt: new Date() })) })
    await db.websiteReceptionistFeedbackUsage.create({ data: { organizationId: org, day: new Date(new Date().toISOString().slice(0, 10)), reports: 49 } })
    const a = await answered(); await website.submitWebsiteFeedback(publicId, a.session.token, a.input, context); const row = await db.websiteReceptionistFeedback.findFirstOrThrow({ where: { requestId: a.input.requestId } }); await service.changeVisitorFeedback(org, admin, row.id, { action: 'delete', expectedUpdatedAt: row.updatedAt.toISOString() })
    const b = await answered(); await expect(website.submitWebsiteFeedback(publicId, b.session.token, b.input, context)).rejects.toMatchObject({ statusCode: 429 }); expect(await db.websiteReceptionistFeedback.count()).toBe(49)
  })
  it('serializes feedback policy with ordinary settings saves at the shared organization boundary', async () => {
    const policy = await service.getVisitorFeedbackPolicy(org, admin), { publicId: _id, updatedAt, ...values } = (await website.getWebsiteReceptionistAdmin(org, admin)).settings!
    let resume: () => void = () => {}, reached: () => void = () => {}, paused = false, policyDone = false
    const barrier = new Promise<void>(done => { resume = done }), ready = new Promise<void>(done => { reached = done }), transaction = db.$transaction.bind(db) as any
    const spy = vi.spyOn(db as any, '$transaction').mockImplementation((action: any, options: any) => transaction(async (tx: any) => action(new Proxy(tx, { get(target, key) {
      if (key === 'websiteReceptionistConfig') return new Proxy(target[key], { get(delegate, method) { if (method === 'findUnique') return async (...args: any[]) => { const value = await delegate.findUnique(...args); if (!paused) { paused = true; reached(); await barrier }; return value }; const value = delegate[method]; return typeof value === 'function' ? value.bind(delegate) : value } })
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
    } })), { ...options, timeout: 15000 }))
    try {
      const ordinary = website.saveWebsiteReceptionist(org, admin, { ...values, dailyCallbackLimit: 11, expectedUpdatedAt: updatedAt, acknowledged: true }); await ready
      const change = service.saveVisitorFeedbackPolicy(org, admin, { enabled: true, acknowledged: true, expectedUpdatedAt: policy.updatedAt }); const observed = change.then(() => { policyDone = true }, () => { policyDone = true })
      let blocked = false; for (let i = 0; i < 100 && !policyDone; i++) { blocked = sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%' AND query LIKE '%Organization%'") !== '0'; if (blocked) break; await new Promise(done => setTimeout(done, 10)) }
      expect(policyDone || blocked).toBe(true); resume(); const results = await Promise.allSettled([ordinary, change]); await observed; expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1); expect(results.filter(value => value.status === 'rejected')).toHaveLength(1)
    } finally { resume(); spy.mockRestore(); (db as any).$transaction = transaction }
  })
  it('creates one private FAQ draft under concurrent/retried approvals and retains ordinary Library publication gates', async () => {
    const row = await saved(); const input = { expectedUpdatedAt: row.updatedAt.toISOString() }; const before = await db.knowledgeDocument.count()
    const drafts = await Promise.all(Array.from({ length: 4 }, () => service.createVisitorFeedbackFaq(org, admin, row.id, input))); expect(new Set(drafts.map(x => x.documentId)).size).toBe(1); expect(await db.knowledgeDocument.count()).toBe(before + 1)
    const draft = await db.knowledgeDocument.findUniqueOrThrow({ where: { id: drafts[0].documentId } }); expect(draft.category).toBe('FAQ'); expect(draft.contentText).toBe(`Question: ${row.question}\n\nAnswer:\n`); expect(draft.publishedAt).toBeNull(); expect(draft.receptionistApprovedRevision).toBeNull(); expect(await db.auditEntry.count({ where: { entityId: draft.id, action: 'CREATE' } })).toBe(1); expect(await db.lead.count()).toBe(0); expect(await db.task.count()).toBe(0)
  })
  it('applies the shared active-document cap and rejects stale creation/review/delete', async () => {
    const row = await saved(); await db.knowledgeDocument.createMany({ data: Array.from({ length: 49 }, () => ({ organizationId: org, createdById: admin, title: 'Synthetic active document', category: 'GENERAL', contentText: 'Synthetic content' })) })
    await expect(service.createVisitorFeedbackFaq(org, admin, row.id, { expectedUpdatedAt: row.updatedAt.toISOString() })).rejects.toMatchObject({ statusCode: 400 }); expect((await db.websiteReceptionistFeedback.findUniqueOrThrow({ where: { id: row.id } })).faqDocumentId).toBeNull()
    await service.changeVisitorFeedback(org, admin, row.id, { action: 'dismiss', expectedUpdatedAt: row.updatedAt.toISOString() })
    for (const action of ['reopen', 'delete']) await expect(service.changeVisitorFeedback(org, admin, row.id, { action, expectedUpdatedAt: row.updatedAt.toISOString() })).rejects.toMatchObject({ statusCode: 409 })
    await expect(service.createVisitorFeedbackFaq(org, admin, row.id, { expectedUpdatedAt: row.updatedAt.toISOString() })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('expires/purges feedback and permits manual deletion without deleting explicitly saved FAQ drafts', async () => {
    const row = await saved(); const draft = await service.createVisitorFeedbackFaq(org, admin, row.id, { expectedUpdatedAt: row.updatedAt.toISOString() })
    await db.websiteReceptionistFeedback.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 31 * 86400000) } }); expect((await service.getVisitorFeedbackList(org, admin, {})).rows).toHaveLength(0); expect(await service.cleanupVisitorFeedback()).toBe(1); expect(await db.knowledgeDocument.findUnique({ where: { id: draft.documentId } })).not.toBeNull(); expect(await service.cleanupVisitorFeedback()).toBe(0)
    const fresh = await db.websiteReceptionistFeedback.create({ data: { organizationId: org, sourceSessionId: randomUUID(), requestId: randomUUID(), question: 'Delete this', siteOrigin, consentedAt: new Date(), faqDocumentId: draft.documentId } }); await service.changeVisitorFeedback(org, admin, fresh.id, { action: 'delete', expectedUpdatedAt: fresh.updatedAt.toISOString() }); expect(await db.knowledgeDocument.findUnique({ where: { id: draft.documentId } })).not.toBeNull()
  })
})
