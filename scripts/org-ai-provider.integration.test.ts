import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const container = `flowrish-org-ai-${process.pid}`
const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/env', () => ({ env: { EMAIL_ENCRYPTION_KEY: '12'.repeat(32), AI_API_KEY: 'synthetic-platform-credential' } }))
let db: PrismaClient
let service: typeof import('../src/server/services/org-ai-provider')
let secrets: typeof import('../src/server/services/org-ai-secret')
let databaseStarted = false
const orgId = randomUUID(), otherOrgId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID()
const defaults = { provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic-organization-credential', enabled: true, dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000, expectedUpdatedAt: null }

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
async function save(overrides: Record<string, unknown> = {}, organizationId = orgId, actor = userId) {
  const current = await service.getAiProviderSettings(actor, organizationId)
  return service.saveAiProviderSettings(actor, organizationId, { ...defaults, expectedUpdatedAt: current.config?.updatedAt ?? null, ...overrides })
}
async function runtime(organizationId = orgId) {
  const result = await service.resolveOrganizationAi(organizationId)
  if (!result) throw new Error('Missing synthetic config')
  return result
}
async function today(organizationId = orgId) {
  return db.aiUsageDay.findUnique({ where: { organizationId_day: { organizationId, day: new Date(new Date().toISOString().slice(0, 10)) } } })
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
  service = await import('../src/server/services/org-ai-provider')
  secrets = await import('../src/server/services/org-ai-secret')
  for (const [organizationId, actor] of [[orgId, userId], [otherOrgId, otherUserId]]) {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic AI workspace', slug: organizationId } })
    await db.user.create({ data: { id: actor, authId: randomUUID(), name: 'AI administrator', email: `${actor}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId, userId: actor } })
    const role = await db.role.create({ data: { organizationId, name: 'AI administrator', hierarchy: 1, permissions: { create: [{ key: 'admin:settings' }] } } })
    const team = await db.team.create({ data: { organizationId, name: 'AI team' } })
    await db.teamMember.create({ data: { userId: actor, teamId: team.id, roleId: role.id } })
  }
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  await db.aiUsageDay.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
  await db.aiProviderConfig.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } })
})
afterAll(async () => { vi.unstubAllGlobals(); if (db) await db.$disconnect(); if (databaseStarted) docker('stop', container) })

describe('organization AI on disposable PostgreSQL', () => {
  it('enables RLS and denies anon and authenticated direct access to both tables', () => {
    expect(sql("SELECT count(*) FROM pg_class WHERE relname IN ('AiProviderConfig','AiUsageDay') AND relrowsecurity")).toBe('2')
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['AiProviderConfig', 'AiUsageDay']) {
        expect(sql(`SELECT has_table_privilege('${role}', '"${table}"', 'SELECT')`)).toBe('f')
        expect(sql(`SELECT has_table_privilege('${role}', '"${table}"', 'INSERT')`)).toBe('f')
        expect(() => sql(`SET ROLE ${role}; SELECT * FROM "${table}"`)).toThrow()
      }
    }
  })

  it('stores authenticated encryption and returns safe settings without automatic provider calls', async () => {
    const view = await save()
    const stored = await db.aiProviderConfig.findUniqueOrThrow({ where: { organizationId: orgId } })
    expect(stored.apiKeyCiphertext).not.toContain(defaults.apiKey)
    expect(stored.apiKeyCiphertext).toMatch(/^v1:/)
    expect(secrets.decryptAiKey(stored.apiKeyCiphertext, orgId, 'deepseek')).toBe(defaults.apiKey)
    expect(JSON.stringify(view)).not.toContain(defaults.apiKey)
    expect(JSON.stringify(view)).not.toContain(stored.apiKeyCiphertext)
    expect(view.config).toMatchObject({ hasKey: true, provider: 'deepseek' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await today()).toBeNull()
  })

  it('rejects cross-organization credentials and provider substitution', async () => {
    await save()
    await save({}, otherOrgId, otherUserId)
    const first = await db.aiProviderConfig.findUniqueOrThrow({ where: { organizationId: orgId } })
    await db.aiProviderConfig.update({ where: { organizationId: otherOrgId }, data: { apiKeyCiphertext: first.apiKeyCiphertext } })
    await expect(service.resolveOrganizationAi(otherOrgId)).rejects.toMatchObject({ code: 'AI_CONFIG_INVALID' })
    await db.aiProviderConfig.update({ where: { organizationId: orgId }, data: { provider: 'openai' } })
    await expect(service.resolveOrganizationAi(orgId)).rejects.toMatchObject({ code: 'AI_CONFIG_INVALID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rechecks actual membership and permissions across organizations', async () => {
    await save()
    await expect(service.getAiProviderSettings(userId, otherOrgId)).rejects.toMatchObject({ statusCode: 403 })
    await db.organizationMember.create({ data: { organizationId: otherOrgId, userId } })
    try {
      await expect(service.saveAiProviderSettings(userId, otherOrgId, defaults)).rejects.toMatchObject({ statusCode: 403 })
      await expect(service.testAiProviderSettings(userId, otherOrgId, new Date().toISOString())).rejects.toMatchObject({ statusCode: 403 })
    } finally { await db.organizationMember.delete({ where: { userId_organizationId: { userId, organizationId: otherOrgId } } }) }
    await db.organizationMember.delete({ where: { userId_organizationId: { userId, organizationId: orgId } } })
    try { await expect(service.getAiProviderSettings(userId, orgId)).rejects.toMatchObject({ statusCode: 403 }) }
    finally { await db.organizationMember.create({ data: { organizationId: orgId, userId } }) }
  })

  it('rejects stale versions, keeps blank same-provider keys, and requires a new key on provider changes', async () => {
    const first = await save()
    const stored = await db.aiProviderConfig.findUniqueOrThrow({ where: { organizationId: orgId } })
    const second = await save({ apiKey: '' })
    expect(second.config!.updatedAt).not.toBe(first.config!.updatedAt)
    expect((await db.aiProviderConfig.findUniqueOrThrow({ where: { organizationId: orgId } })).apiKeyCiphertext).toBe(stored.apiKeyCiphertext)
    await expect(save({ expectedUpdatedAt: first.config!.updatedAt })).rejects.toMatchObject({ statusCode: 409 })
    await expect(save({ provider: 'openai', model: 'gpt-4o-mini', apiKey: '' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(service.testAiProviderSettings(userId, orgId, first.config!.updatedAt)).rejects.toMatchObject({ statusCode: 409 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows one concurrent first save and rejects the other with a conflict', async () => {
    const results = await Promise.allSettled([service.saveAiProviderSettings(userId, orgId, defaults), service.saveAiProviderSettings(userId, orgId, defaults)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejection.reason).toMatchObject({ statusCode: 409 })
    expect(await db.aiProviderConfig.count({ where: { organizationId: orgId } })).toBe(1)
  })

  it('returns null only for absent configuration and fails closed after pause or version changes', async () => {
    expect(await service.resolveOrganizationAi(orgId)).toBeNull()
    await save()
    const old = await runtime()
    await save({ enabled: false })
    await expect(service.resolveOrganizationAi(orgId)).rejects.toMatchObject({ code: 'AI_PAUSED' })
    await expect(service.reserveAiUsage(old, 100, 32)).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' })
    await save({ enabled: true })
    await expect(service.reserveAiUsage(old, 100, 32)).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' })
    expect(await today()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('atomically admits only the request limit under 30 concurrent reservations and isolates other organizations', async () => {
    await save({ dailyRequestLimit: 3 })
    await save({}, otherOrgId, otherUserId)
    const current = await runtime()
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => service.reserveAiUsage(current, 100, 32)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(27)
    expect(await today()).toMatchObject({ requests: 3, reservedTokens: 1164, completedRequests: 0, failedRequests: 0 })
    await service.reserveAiUsage(await runtime(otherOrgId), 100, 32)
    expect(await today(otherOrgId)).toMatchObject({ requests: 1, reservedTokens: 388 })
  })

  it('guards the token budget under concurrency and rejects oversized input without charging', async () => {
    await save({ dailyTokenLimit: 1000 })
    const current = await runtime()
    await expect(service.reserveAiUsage(current, 16001, 32)).rejects.toMatchObject({ code: 'AI_INPUT_TOO_LARGE' })
    expect(await today()).toBeNull()
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => service.reserveAiUsage(current, 100, 32)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(await today()).toMatchObject({ requests: 2, reservedTokens: 776 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains failed or interrupted reservations and adds only excess reported tokens', async () => {
    await save()
    const current = await runtime()
    const failed = await service.reserveAiUsage(current, 100, 32)
    await service.finishAiUsage(failed, { success: false })
    expect(await today()).toMatchObject({ requests: 1, reservedTokens: 388, failedRequests: 1, completedRequests: 0, reportedTokens: 0 })
    await service.reserveAiUsage(current, 100, 32)
    const completed = await service.reserveAiUsage(current, 100, 32)
    await service.finishAiUsage(completed, { success: true, totalTokens: 500 })
    expect(await today()).toMatchObject({ requests: 3, reservedTokens: 1276, completedRequests: 1, failedRequests: 1, reportedTokens: 500 })
  })

  it('finishes on the reservation UTC day after a simulated midnight', async () => {
    await save()
    const previousDay = new Date('2020-01-01T00:00:00.000Z')
    await db.aiUsageDay.create({ data: { organizationId: orgId, day: previousDay, requests: 1, reservedTokens: 388 } })
    await service.reserveAiUsage(await runtime(), 100, 32)
    await service.finishAiUsage({ organizationId: orgId, day: previousDay, reservedTokens: 388 }, { success: true, totalTokens: 450 })
    expect(await db.aiUsageDay.findUnique({ where: { organizationId_day: { organizationId: orgId, day: previousDay } } })).toMatchObject({ reservedTokens: 450, completedRequests: 1, reportedTokens: 450 })
    expect(await today()).toMatchObject({ reservedTokens: 388, completedRequests: 0, reportedTokens: 0 })
  })

  it('uses one explicit bounded DeepSeek probe and charges it while saves make no request', async () => {
    const saved = await save()
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { total_tokens: 20 } }), { status: 200 }))
    await expect(service.testAiProviderSettings(userId, orgId, saved.config!.updatedAt)).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body)).toMatchObject({ max_tokens: 32, thinking: { type: 'disabled' } })
    expect(await today()).toMatchObject({ requests: 1, completedRequests: 1, failedRequests: 0, reportedTokens: 20 })
  })

  it('bounds Gemini reasoning/output and masks probe failures while retaining reservations', async () => {
    const saved = await save({ provider: 'gemini', model: 'gemini-3.1-flash-lite' })
    fetchMock.mockResolvedValueOnce(new Response('synthetic-organization-credential private upstream error', { status: 400 }))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(service.testAiProviderSettings(userId, orgId, saved.config!.updatedAt)).rejects.toMatchObject({ code: 'AI_CONNECTION_FAILED', message: expect.not.stringContaining(defaults.apiKey) })
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(JSON.parse(options.body)).toMatchObject({ reasoning_effort: 'low', max_tokens: 2048 })
    const usage = await today()
    expect(usage).toMatchObject({ requests: 1, completedRequests: 0, failedRequests: 1, reportedTokens: 0 })
    expect(usage!.reservedTokens).toBeGreaterThan(2048)
  })
})
