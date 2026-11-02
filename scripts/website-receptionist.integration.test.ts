import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const generation = vi.hoisted(() => vi.fn())
const publicGeneration = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/ai', () => ({ generateWebsiteReceptionistText: publicGeneration }))
vi.mock('../src/server/services/website-receptionist-generation', () => ({ generateWebsiteReceptionistAnswer: generation }))
const container = `flowrish-website-test-${randomUUID()}`
const org = randomUUID(), other = randomUUID(), user = randomUUID()
const context = { ip: '192.0.2.1', origin: 'https://app.example.invalid' }
const origin = 'https://business.example.invalid'
const input = { enabled: true, allowedOrigins: [origin], dailyMessageLimit: 20, dailyTokenLimit: 200000, dailyCallbackLimit: 50, expectedUpdatedAt: null as string | null, acknowledged: true }
const callback = { fullName: 'Fictional Visitor', phone: '+12025550123', reason: 'Please explain bicycle repair.', confirmed: true, website: '' }
let db: PrismaClient, service: typeof import('../src/server/services/website-receptionist'), publicId: string, started = false
function docker(...args: string[]) { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
function sql(query: string) { return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
async function start(ip = context.ip) { return service.startWebsiteSession(publicId, { siteOrigin: origin, website: '' }, { ...context, ip }) }
async function age(token: string, values: Record<string, unknown> = {}) { await db.websiteReceptionistSession.update({ where: { tokenHash: createHash('sha256').update(token).digest('hex') }, data: { createdAt: new Date(Date.now() - 3000), ...values } }) }
function message(expectedTurn = 0, requestId = randomUUID()) { return { question: 'What repairs do you provide?', history: [], website: '', expectedTurn, requestId } }
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16'); started = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) { try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`; process.env.DIRECT_URL = process.env.DATABASE_URL
  process.env.EMAIL_ENCRYPTION_KEY = 'ab'.repeat(32)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Provider transport forbidden during verification') }))
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) { if (name !== 'migration_lock.toml') sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')) }
  ;({ prisma: db } = await import('../src/server/db/client')); service = await import('../src/server/services/website-receptionist')
  await db.organization.createMany({ data: [{ id: org, name: 'Fictional Website Business', slug: `website-${org}` }, { id: other, name: 'Untouched Control', slug: `website-${other}` }] })
  await db.user.create({ data: { id: user, authId: randomUUID(), name: 'Fictional Admin', email: `${user}@example.invalid` } })
  await db.organizationMember.create({ data: { userId: user, organizationId: org } })
  const role = await db.role.create({ data: { name: `WebsiteAdmin-${org}`, hierarchy: 3, permissions: { create: { key: 'admin:settings' } } } })
  const team = await db.team.create({ data: { name: 'Website verification', organizationId: org } })
  await db.teamMember.create({ data: { teamId: team.id, userId: user, roleId: role.id } })
  await db.receptionistConfig.create({ data: { organizationId: org, settings: { enabled: false, businessName: 'Fictional Bicycle Repairs', knowledge: '', mode: 'always', timeZone: 'UTC', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' } } })
  await db.aiProviderConfig.create({ data: { organizationId: org, provider: 'openai', model: 'fictional-model', apiKeyCiphertext: 'not-a-real-encrypted-secret' } })
  await db.knowledgeDocument.create({ data: { organizationId: org, title: 'Repairs', category: 'GENERAL', contentText: 'We repair bicycles.', publishedText: 'We repair bicycles.', publishedRevision: 1, publishedAt: new Date(), receptionistApprovedRevision: 1, receptionistApprovedAt: new Date(), createdById: user } })
}, 60_000)
beforeEach(async () => {
  generation.mockReset().mockResolvedValue('We repair bicycles. Please request a callback for a quotation.')
  await db.websiteReceptionistCallback.deleteMany(); await db.websiteReceptionistSession.deleteMany(); await db.websiteReceptionistUsage.deleteMany(); await db.websiteReceptionistConfig.deleteMany()
  await db.aiProviderConfig.update({ where: { organizationId: org }, data: { enabled: true } })
  const saved = await service.saveWebsiteReceptionist(org, user, input); publicId = saved.settings!.publicId
})
afterAll(async () => { await db?.$disconnect(); vi.unstubAllGlobals(); if (started) docker('rm', '-f', container) })
describe('website receptionist on disposable PostgreSQL, without provider transport', () => {
  it('creates only private opt-in tables with revoked roles and disabled defaults', async () => {
    const config = await db.websiteReceptionistConfig.create({ data: { organizationId: other } }); expect(config.enabled).toBe(false)
    expect(sql(`SELECT count(*) FROM pg_class WHERE relname IN ('WebsiteReceptionistConfig','WebsiteReceptionistUsage','WebsiteReceptionistSession','WebsiteReceptionistCallback') AND relrowsecurity`)).toBe('4')
    for (const role of ['anon', 'authenticated']) for (const table of ['WebsiteReceptionistConfig', 'WebsiteReceptionistUsage', 'WebsiteReceptionistSession', 'WebsiteReceptionistCallback']) expect(sql(`SELECT has_table_privilege('${role}', '"${table}"', 'SELECT,INSERT,UPDATE,DELETE')`)).toBe('f')
    await expect(service.getWebsiteReceptionistEmbed(config.publicId, origin)).rejects.toMatchObject({ statusCode: 403 })
    expect(generation).not.toHaveBeenCalled()
  })
  it('requires fresh membership, readiness, explicit acknowledgment and config CAS', async () => {
    await expect(service.getWebsiteReceptionistAdmin(other, user)).rejects.toMatchObject({ statusCode: 403 })
    await expect(service.saveWebsiteReceptionist(org, user, input)).rejects.toMatchObject({ statusCode: 409 })
    const config = (await service.getWebsiteReceptionistAdmin(org, user)).settings!
    await expect(service.saveWebsiteReceptionist(org, user, { ...input, expectedUpdatedAt: config.updatedAt, acknowledged: false })).rejects.toBeDefined()
    await db.aiProviderConfig.update({ where: { organizationId: org }, data: { enabled: false } })
    await expect(service.saveWebsiteReceptionist(org, user, { ...input, expectedUpdatedAt: config.updatedAt })).rejects.toMatchObject({ statusCode: 400 })
    expect(await db.lead.count()).toBe(0); expect(await db.task.count()).toBe(0); expect(await db.activity.count()).toBe(0)
  })
  it('binds sessions to allowed origin, IP, public organization, expiry and config version', async () => {
    await expect(service.startWebsiteSession(publicId, { siteOrigin: 'https://evil.invalid', website: '' }, context)).rejects.toMatchObject({ statusCode: 403 })
    const session = await start(); await age(session.token)
    await expect(service.sendWebsiteMessage(publicId, session.token, message(), { ...context, ip: '192.0.2.2' })).rejects.toMatchObject({ statusCode: 403 })
    const otherConfig = await db.websiteReceptionistConfig.create({ data: { organizationId: other, enabled: true, allowedOrigins: [origin] } })
    await expect(service.sendWebsiteMessage(otherConfig.publicId, session.token, message(), context)).rejects.toMatchObject({ statusCode: 403 })
    await age(session.token, { expiresAt: new Date(Date.now() - 1) })
    await expect(service.submitWebsiteCallback(publicId, session.token, callback, context)).rejects.toMatchObject({ statusCode: 410, code: 'WEBSITE_SESSION_EXPIRED' })
    const next = await start(); await age(next.token)
    const current = (await service.getWebsiteReceptionistAdmin(org, user)).settings!
    await service.saveWebsiteReceptionist(org, user, { ...input, expectedUpdatedAt: current.updatedAt })
    await expect(service.sendWebsiteMessage(publicId, next.token, message(), context)).rejects.toMatchObject({ statusCode: 410, code: 'WEBSITE_SESSION_EXPIRED' })
    expect(generation).not.toHaveBeenCalled()
  })
  it('enforces minimum session age without consuming message or callback budget', async () => {
    const session = await start()
    await expect(service.sendWebsiteMessage(publicId, session.token, message(), context)).rejects.toMatchObject({ statusCode: 429 })
    await expect(service.submitWebsiteCallback(publicId, session.token, callback, context)).rejects.toMatchObject({ statusCode: 429 })
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage.messages).toBe(0)
  })
  it('atomically enforces five IP starts and twenty organization starts', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 9 }, () => start()))
    expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(5)
    const rest = await Promise.allSettled(Array.from({ length: 25 }, (_, index) => start(`198.51.100.${index + 1}`)))
    expect(rest.filter(x => x.status === 'fulfilled')).toHaveLength(15)
    const usage = (await service.getWebsiteReceptionistAdmin(org, user)).usage
    expect(usage.sessions).toBe(20)
    const state = await db.websiteReceptionistSession.findFirstOrThrow(); expect(state.ipHash).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(state)).not.toContain(context.ip)
  })
  it('reserves tokens atomically, returns cached retries free, and keeps questions out of storage', async () => {
    await db.websiteReceptionistConfig.update({ where: { organizationId: org }, data: { dailyTokenLimit: 9656 } })
    const first = await start(), second = await start('192.0.2.2'); await age(first.token); await age(second.token)
    const request = message()
    const results = await Promise.allSettled([service.sendWebsiteMessage(publicId, first.token, request, context), service.sendWebsiteMessage(publicId, second.token, message(), { ...context, ip: '192.0.2.2' })])
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage).toMatchObject({ messages: 1, reservedTokens: 9656 })
    const success = results[0].status === 'fulfilled' ? { token: first.token, request, ctx: context, result: results[0].value } : { token: second.token, request: null, ctx: { ...context, ip: '192.0.2.2' }, result: null }
    if (success.request) expect(await service.sendWebsiteMessage(publicId, success.token, success.request, success.ctx)).toEqual(success.result)
    expect(generation).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(await db.websiteReceptionistSession.findMany())).not.toContain(request.question)
  })
  it('claims one lease before generation and rejects overlapping requests without additional spend', async () => {
    const session = await start(); await age(session.token)
    let release!: (value: string) => void
    generation.mockImplementation(() => new Promise<string>(resolve => { release = resolve }))
    const request = message(), pending = service.sendWebsiteMessage(publicId, session.token, request, context)
    await vi.waitFor(() => expect(generation).toHaveBeenCalledTimes(1))
    await expect(service.sendWebsiteMessage(publicId, session.token, request, context)).rejects.toMatchObject({ statusCode: 409 })
    release('Please request a callback.'); const result = await pending
    expect(await service.sendWebsiteMessage(publicId, session.token, request, context)).toEqual(result)
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage.messages).toBe(1)
  })
  it('closes expired leases and never finalizes a stale generation', async () => {
    const session = await start(); await age(session.token)
    let release!: (value: string) => void
    generation.mockImplementation(() => new Promise<string>(resolve => { release = resolve }))
    const pending = service.sendWebsiteMessage(publicId, session.token, message(), context)
    await vi.waitFor(() => expect(generation).toHaveBeenCalledTimes(1))
    await age(session.token, { leaseExpiresAt: new Date(Date.now() - 1) })
    await expect(service.sendWebsiteMessage(publicId, session.token, message(), context)).rejects.toMatchObject({ statusCode: 409, code: 'WEBSITE_CHAT_CLOSED' })
    release('Stale response'); await expect(pending).rejects.toMatchObject({ statusCode: 409 })
    expect((await db.websiteReceptionistSession.findFirstOrThrow()).closed).toBe(true)
    await expect(service.sendWebsiteMessage(publicId, session.token, message(), context)).rejects.toMatchObject({ statusCode: 409, code: 'WEBSITE_CHAT_CLOSED' })
    expect(await service.submitWebsiteCallback(publicId, session.token, callback, context)).toEqual({ received: true })
  })
  it('returns restartable expiry if a valid session expires while its answer is being generated', async () => {
    const session = await start(); await age(session.token, { expiresAt: new Date(Date.now() + 300) })
    let release!: (value: string) => void
    generation.mockImplementation(() => new Promise<string>(resolve => { release = resolve }))
    const pending = service.sendWebsiteMessage(publicId, session.token, message(), context)
    await vi.waitFor(() => expect(generation).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 350))
    release('Expired answer')
    await expect(pending).rejects.toMatchObject({ statusCode: 410, code: 'WEBSITE_SESSION_EXPIRED' })
  })
  it('checks current AI metadata before generation and closes chat safely on failure', async () => {
    const session = await start(); await age(session.token)
    await db.aiProviderConfig.update({ where: { organizationId: org }, data: { enabled: false } })
    const reply = await service.sendWebsiteMessage(publicId, session.token, message(), context)
    expect(reply.canMessage).toBe(false); expect(reply.reply).toContain('callback'); expect(generation).not.toHaveBeenCalled()
    expect(await service.submitWebsiteCallback(publicId, session.token, callback, context)).toEqual({ received: true })
  })
  it('enforces the six turn session cap and ten daily messages per IP across sessions', async () => {
    const first = await start(); await age(first.token)
    for (let turn = 0; turn < 6; turn++) expect((await service.sendWebsiteMessage(publicId, first.token, message(turn), context)).canMessage).toBe(turn < 5)
    await expect(service.sendWebsiteMessage(publicId, first.token, message(6), context)).rejects.toMatchObject({ statusCode: 409 })
    const second = await start(); await age(second.token)
    for (let turn = 0; turn < 4; turn++) await service.sendWebsiteMessage(publicId, second.token, message(turn), context)
    await expect(service.sendWebsiteMessage(publicId, second.token, message(4), context)).rejects.toMatchObject({ statusCode: 429 })
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage).toMatchObject({ messages: 10, reservedTokens: 96560 })
    expect(generation).toHaveBeenCalledTimes(10)
  })
  it('atomically respects configured organization message and callback caps across IPs', async () => {
    await db.websiteReceptionistConfig.update({ where: { organizationId: org }, data: { dailyMessageLimit: 1, dailyCallbackLimit: 1 } })
    const sessions = await Promise.all(Array.from({ length: 3 }, (_, i) => start(`192.0.2.${i + 1}`))); await Promise.all(sessions.map(x => age(x.token)))
    const messages = await Promise.allSettled(sessions.map((x, i) => service.sendWebsiteMessage(publicId, x.token, message(), { ...context, ip: `192.0.2.${i + 1}` })))
    expect(messages.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    const callbacks = await Promise.allSettled(sessions.map((x, i) => service.submitWebsiteCallback(publicId, x.token, callback, { ...context, ip: `192.0.2.${i + 1}` })))
    expect(callbacks.filter(x => x.status === 'fulfilled')).toHaveLength(1)
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage).toMatchObject({ messages: 1, callbacks: 1 })
  })
  it('never returns provider failures and keeps failed message reservations', async () => {
    const session = await start(); await age(session.token); const request = message()
    generation.mockRejectedValue(new Error('sensitive provider secret and endpoint'))
    const reply = await service.sendWebsiteMessage(publicId, session.token, request, context)
    expect(reply).toMatchObject({ canMessage: false, turn: 1 }); expect(JSON.stringify(reply)).not.toContain('sensitive')
    expect(await service.sendWebsiteMessage(publicId, session.token, request, context)).toEqual(reply)
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage).toMatchObject({ messages: 1, reservedTokens: 9656 })
    expect(await service.submitWebsiteCallback(publicId, session.token, callback, context)).toEqual({ received: true })
  })
  it('requires confirmed structured callbacks and preserves deletion marker under duplicates', async () => {
    const session = await start(); await age(session.token)
    await expect(service.submitWebsiteCallback(publicId, session.token, { ...callback, confirmed: false }, context)).rejects.toBeDefined()
    const results = await Promise.all(Array.from({ length: 5 }, () => service.submitWebsiteCallback(publicId, session.token, callback, context)))
    expect(results).toHaveLength(5); expect(await db.websiteReceptionistCallback.count()).toBe(1)
    const rows = await service.listWebsiteCallbacks(org, user, {}); const record = rows.callbacks[0]
    await expect(service.reviewWebsiteCallback(other, user, record.id, { action: 'review', expectedUpdatedAt: record.updatedAt })).rejects.toMatchObject({ statusCode: 403 })
    const reviewed = await service.reviewWebsiteCallback(org, user, record.id, { action: 'review', expectedUpdatedAt: record.updatedAt }); expect(reviewed.status).toBe('reviewed')
    await expect(service.reviewWebsiteCallback(org, user, record.id, { action: 'dismiss', expectedUpdatedAt: record.updatedAt })).rejects.toMatchObject({ statusCode: 409 })
    await service.deleteWebsiteCallback(org, user, record.id)
    expect(await service.submitWebsiteCallback(publicId, session.token, callback, context)).toEqual({ received: true })
    expect(await db.websiteReceptionistCallback.count()).toBe(0)
    expect((await service.getWebsiteReceptionistAdmin(org, user)).usage.callbacks).toBe(1)
    expect(generation).not.toHaveBeenCalled()
  })
  it('does not authorize removed members or members without an effective settings permission', async () => {
    const outsider = randomUUID()
    await db.user.create({ data: { id: outsider, authId: randomUUID(), name: 'Fictional Member', email: `${outsider}@example.invalid` } })
    await db.organizationMember.create({ data: { userId: outsider, organizationId: org } })
    await expect(service.getWebsiteReceptionistAdmin(org, outsider)).rejects.toMatchObject({ statusCode: 403 })
    await db.organizationMember.delete({ where: { userId_organizationId: { userId: outsider, organizationId: org } } })
    await expect(service.listWebsiteCallbacks(org, outsider, {})).rejects.toMatchObject({ statusCode: 403 })
  })
  it('disables without deleting confirmed requests or other organizations and invalidates live tokens', async () => {
    const session = await start(); await age(session.token); await service.submitWebsiteCallback(publicId, session.token, callback, context)
    const config = (await service.getWebsiteReceptionistAdmin(org, user)).settings!
    const control = await db.websiteReceptionistConfig.create({ data: { organizationId: other } })
    const disabled = await service.saveWebsiteReceptionist(org, user, { ...input, enabled: false, expectedUpdatedAt: config.updatedAt })
    expect(disabled.settings?.enabled).toBe(false); expect(await db.websiteReceptionistCallback.count()).toBe(1)
    await expect(service.submitWebsiteCallback(publicId, session.token, callback, context)).rejects.toMatchObject({ statusCode: 403 })
    expect(await db.websiteReceptionistConfig.findUnique({ where: { organizationId: other } })).toEqual(control)
    expect(generation).not.toHaveBeenCalled()
  })
  it('atomically caps callback IP totals, retains callbacks through cleanup and touches no CRM/provider config', async () => {
    const sessions = await Promise.all(Array.from({ length: 5 }, () => start())); await Promise.all(sessions.map(x => age(x.token)))
    const callbacks = await Promise.allSettled(sessions.map(x => service.submitWebsiteCallback(publicId, x.token, callback, context)))
    expect(callbacks.filter(x => x.status === 'fulfilled')).toHaveLength(3)
    await db.websiteReceptionistSession.updateMany({ data: { expiresAt: new Date(Date.now() - 25 * 3600_000) } })
    await db.websiteReceptionistUsage.create({ data: { organizationId: org, day: new Date('2000-01-01T00:00:00Z'), scope: 'org' } })
    const ai = await db.aiProviderConfig.findUniqueOrThrow({ where: { organizationId: org } })
    expect(await service.cleanupWebsiteReceptionist()).toMatchObject({ sessions: 5, usage: 1 })
    expect(await db.websiteReceptionistCallback.count()).toBe(3); expect(await db.aiProviderConfig.findUnique({ where: { organizationId: org } })).toEqual(ai)
    expect(await db.lead.count()).toBe(0); expect(await db.task.count()).toBe(0); expect(await db.activity.count()).toBe(0); expect(await db.receptionistCall.count()).toBe(0); expect(await db.emailMessage.count()).toBe(0); expect(generation).not.toHaveBeenCalled()
  })
  it('uses complete approved paragraphs through real publication chunks and tenant-scoped SQL', async () => {
    const knowledge = await import('../src/server/services/knowledge')
    const actual = await vi.importActual<typeof import('../src/server/services/website-receptionist-generation')>('../src/server/services/website-receptionist-generation')
    const paragraph = 'Bicycleprice repair price is 500 pesos. ' + 'Additional explanation is provided here. '.repeat(35) + 'That price applies only when a paid inspection has already been completed.'
    const document = await db.knowledgeDocument.create({ data: { organizationId: org, createdById: user, title: 'Fictional fee qualification', category: 'PRICING', contentText: paragraph } })
    await knowledge.transitionKnowledge(org, user, document.id, { action: 'publish', revision: 1 })
    await knowledge.transitionKnowledge(org, user, document.id, { action: 'approve_receptionist', revision: 2, publishedRevision: 2, acknowledged: true })
    expect(await db.knowledgeChunk.count({ where: { documentId: document.id } })).toBeGreaterThan(1)
    const privateDocument = await db.knowledgeDocument.create({ data: { organizationId: org, createdById: user, title: 'Unapproved control', category: 'PRICING', contentText: 'Bicycleprice PRIVATE_UNAPPROVED' } })
    await knowledge.transitionKnowledge(org, user, privateDocument.id, { action: 'publish', revision: 1 })
    const control = await db.knowledgeDocument.create({ data: { organizationId: other, createdById: user, title: 'Other tenant', category: 'PRICING', contentText: 'Bicycleprice PRIVATE_OTHER_TENANT', publishedText: 'Bicycleprice PRIVATE_OTHER_TENANT', publishedRevision: 1, publishedAt: new Date(), receptionistApprovedRevision: 1 } })
    await db.knowledgeChunk.create({ data: { organizationId: other, documentId: control.id, revision: 1, ordinal: 0, content: control.contentText, title: control.title, category: control.category } })
    publicGeneration.mockReset().mockResolvedValue('Please request a callback for a quote.')
    await actual.generateWebsiteReceptionistAnswer(org, 'Fictional business', 'Bicycleprice?', [])
    const facts = publicGeneration.mock.calls[0][4]
    expect(facts).toContain('only when a paid inspection'); expect(facts).not.toContain('PRIVATE_'); expect(Buffer.byteLength(facts, 'utf8')).toBeLessThanOrEqual(2200)
    await knowledge.transitionKnowledge(org, user, document.id, { action: 'revoke_receptionist', revision: 3 })
    publicGeneration.mockClear()
    expect(await actual.generateWebsiteReceptionistAnswer(org, 'Fictional business', 'Bicycleprice?', [])).toContain('callback')
    expect(publicGeneration).not.toHaveBeenCalled()
  })
  it('lets an administrator save while a public transaction inserts organization-owned state without a lock cycle', async () => {
    const config = (await service.getWebsiteReceptionistAdmin(org, user)).settings!
    let saving: Promise<unknown> | undefined
    const visitor = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT * FROM "WebsiteReceptionistConfig" WHERE "organizationId" = ${org} FOR UPDATE`
      saving = service.saveWebsiteReceptionist(org, user, { ...input, expectedUpdatedAt: config.updatedAt })
      void saving.catch(() => {})
      await vi.waitFor(async () => {
        const blocked = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%WebsiteReceptionistConfig%'`
        expect(blocked[0].count).toBeGreaterThan(0)
      })
      await tx.websiteReceptionistUsage.create({ data: { organizationId: org, day: new Date('2001-01-01T00:00:00Z'), scope: 'org' } })
    })
    const visited = await visitor.then(() => true, () => false)
    const saved = await saving!.then(() => true, () => false)
    expect({ visited, saved }).toEqual({ visited: true, saved: true })
    await expect(service.saveWebsiteReceptionist(org, user, { ...input, expectedUpdatedAt: config.updatedAt })).rejects.toMatchObject({ statusCode: 409 })
    const latest = (await service.getWebsiteReceptionistAdmin(org, user)).settings!
    const concurrent = await Promise.allSettled([18, 19].map(dailyMessageLimit => service.saveWebsiteReceptionist(org, user, { ...input, dailyMessageLimit, expectedUpdatedAt: latest.updatedAt })))
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = concurrent.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409, code: 'WEBSITE_CONFLICT' })
  })
  it('scopes inbox read, review and deletion even for an administrator of both organizations', async () => {
    const session = await start(); await age(session.token); await service.submitWebsiteCallback(publicId, session.token, callback, context)
    await db.organizationMember.create({ data: { userId: user, organizationId: other } })
    const role = await db.role.create({ data: { name: `DualAdmin-${other}`, hierarchy: 3, permissions: { create: { key: 'admin:settings' } } } })
    const team = await db.team.create({ data: { organizationId: other, name: 'Control admin' } }); await db.teamMember.create({ data: { teamId: team.id, userId: user, roleId: role.id } })
    const record = (await service.listWebsiteCallbacks(org, user, {})).callbacks[0]
    expect((await service.listWebsiteCallbacks(other, user, {})).callbacks).toEqual([])
    await expect(service.reviewWebsiteCallback(other, user, record.id, { action: 'review', expectedUpdatedAt: record.updatedAt })).rejects.toMatchObject({ statusCode: 404 })
    await expect(service.deleteWebsiteCallback(other, user, record.id)).rejects.toMatchObject({ statusCode: 404 })
    expect(await db.websiteReceptionistCallback.count({ where: { organizationId: org } })).toBe(1)
  })
})
