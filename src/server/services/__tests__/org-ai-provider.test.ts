import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ find: vi.fn(), create: vi.fn(), update: vi.fn(), usage: vi.fn(), member: vi.fn(), permissions: vi.fn(), raw: vi.fn(), execute: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/env', () => ({ env: { EMAIL_ENCRYPTION_KEY: '11'.repeat(32), AI_API_KEY: 'platform-key' } }))
vi.mock('@/server/db/client', () => ({ prisma: { aiProviderConfig: { findUnique: mock.find, create: mock.create, updateMany: mock.update }, aiUsageDay: { findUnique: mock.usage }, organizationMember: { findUnique: mock.member }, $queryRaw: mock.raw, $executeRaw: mock.execute } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mock.permissions }))

import { decryptAiKey, encryptAiKey } from '../org-ai-secret'
import { finishAiUsage, getAiProviderSettings, reserveAiUsage, resolveOrganizationAi, saveAiProviderSettings, testAiProviderSettings, type OrganizationAiRuntime } from '../org-ai-provider'

const version = new Date('2026-11-02T00:00:00.000Z')
const limits = { dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000 }
const runtime: OrganizationAiRuntime = { organizationId: 'org-a', version, provider: 'deepseek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-secret', ...limits }
const row = () => ({ organizationId: 'org-a', provider: 'deepseek', model: 'deepseek-flash', apiKeyCiphertext: encryptAiKey('synthetic-secret', 'org-a', 'deepseek'), enabled: true, ...limits, createdAt: version, updatedAt: version })
const input = () => ({ provider: 'deepseek', model: 'deepseek-flash', enabled: true, apiKey: '', ...limits, expectedUpdatedAt: version.toISOString() })

describe('organization AI credentials and settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.member.mockResolvedValue({ userId: 'admin', organizationId: 'org-a' })
    mock.permissions.mockResolvedValue(new Set(['admin:settings']))
    mock.find.mockResolvedValue(row())
    mock.usage.mockResolvedValue(null)
    mock.raw.mockResolvedValue([{ organizationId: 'org-a', day: new Date('2026-11-02'), reservedTokens: 300 }])
    mock.execute.mockResolvedValue(1)
    mock.update.mockResolvedValue({ count: 1 })
    vi.stubGlobal('fetch', mock.fetch)
  })

  it('authenticates ciphertext and binds it to both organization and provider', () => {
    const encrypted = encryptAiKey('synthetic-secret', 'org-a', 'deepseek')
    expect(encrypted).not.toContain('synthetic-secret')
    expect(decryptAiKey(encrypted, 'org-a', 'deepseek')).toBe('synthetic-secret')
    expect(() => decryptAiKey(encrypted, 'org-b', 'deepseek')).toThrow()
    expect(() => decryptAiKey(encrypted, 'org-a', 'openai')).toThrow()
    const pieces = encrypted.split(':')
    pieces[3] = `${pieces[3][0] === '0' ? '1' : '0'}${pieces[3].slice(1)}`
    expect(() => decryptAiKey(pieces.join(':'), 'org-a', 'deepseek')).toThrow()
  })

  it('uses absence as the only fallback signal and fails closed for paused or invalid credentials', async () => {
    expect(await resolveOrganizationAi('org-a')).toMatchObject(runtime)
    mock.find.mockResolvedValueOnce(null)
    expect(await resolveOrganizationAi('org-a')).toBeNull()
    mock.find.mockResolvedValueOnce({ ...row(), enabled: false })
    await expect(resolveOrganizationAi('org-a')).rejects.toMatchObject({ code: 'AI_PAUSED' })
    mock.find.mockResolvedValueOnce({ ...row(), apiKeyCiphertext: 'broken synthetic-secret' })
    await expect(resolveOrganizationAi('org-a')).rejects.toMatchObject({ code: 'AI_CONFIG_INVALID', message: expect.not.stringContaining('synthetic-secret') })
  })

  it('returns safe settings and zero usage without either credential representation', async () => {
    const result = await getAiProviderSettings('admin', 'org-a')
    expect(result.config).toMatchObject({ hasKey: true, provider: 'deepseek', updatedAt: version.toISOString() })
    expect(result.usage).toMatchObject({ requests: 0, reservedTokens: 0, reportedTokens: 0 })
    expect(JSON.stringify(result)).not.toContain('synthetic-secret')
    expect(JSON.stringify(result)).not.toContain('apiKeyCiphertext')
    expect(mock.find).toHaveBeenCalledWith({ where: { organizationId: 'org-a' } })
  })

  it('rechecks membership and effective settings permission for every settings action', async () => {
    mock.member.mockResolvedValue(null)
    await expect(getAiProviderSettings('admin', 'org-a')).rejects.toMatchObject({ statusCode: 403 })
    mock.member.mockResolvedValue({ userId: 'admin' })
    mock.permissions.mockResolvedValue(new Set(['leads:read']))
    await expect(saveAiProviderSettings('admin', 'org-a', input())).rejects.toMatchObject({ statusCode: 403 })
    await expect(testAiProviderSettings('admin', 'org-a', version.toISOString())).rejects.toMatchObject({ statusCode: 403 })
    expect(mock.fetch).not.toHaveBeenCalled()
    expect(mock.update).not.toHaveBeenCalled()
  })

  it('preserves a blank key only for the same provider and saves without fetching', async () => {
    const previous = row()
    mock.find.mockResolvedValue(previous)
    await saveAiProviderSettings('admin', 'org-a', input())
    expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', updatedAt: version }, data: expect.objectContaining({ apiKeyCiphertext: previous.apiKeyCiphertext }) }))
    expect(mock.fetch).not.toHaveBeenCalled()
    await expect(saveAiProviderSettings('admin', 'org-a', { ...input(), provider: 'openai', model: 'gpt-4o-mini' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects stale saves and concurrent first saves with 409', async () => {
    await expect(saveAiProviderSettings('admin', 'org-a', { ...input(), expectedUpdatedAt: null })).rejects.toMatchObject({ statusCode: 409 })
    mock.update.mockResolvedValueOnce({ count: 0 })
    await expect(saveAiProviderSettings('admin', 'org-a', input())).rejects.toMatchObject({ statusCode: 409 })
    mock.find.mockResolvedValue(null)
    mock.create.mockRejectedValue({ code: 'P2002' })
    await expect(saveAiProviderSettings('admin', 'org-a', { ...input(), expectedUpdatedAt: null, apiKey: 'synthetic-secret' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects stale connection tests before spending or sending credentials', async () => {
    await expect(testAiProviderSettings('admin', 'org-a', '2026-11-01T00:00:00.000Z')).rejects.toMatchObject({ statusCode: 409 })
    expect(mock.raw).not.toHaveBeenCalled()
    expect(mock.fetch).not.toHaveBeenCalled()
  })

  it('makes one bounded explicit DeepSeek test without following credential redirects', async () => {
    mock.fetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { total_tokens: 20 } }), { status: 200 }))
    await expect(testAiProviderSettings('admin', 'org-a', version.toISOString())).resolves.toEqual({ ok: true })
    expect(mock.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = mock.fetch.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(options.body)).toMatchObject({ max_tokens: 32, thinking: { type: 'disabled' } })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })

  it('sanitizes upstream body and thrown errors and retains failed usage', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mock.fetch.mockRejectedValue(new Error('synthetic-secret upstream payload'))
    await expect(testAiProviderSettings('admin', 'org-a', version.toISOString())).rejects.toMatchObject({ code: 'AI_CONNECTION_FAILED', message: expect.not.stringContaining('synthetic-secret') })
    expect(mock.execute).toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('conservative organization AI reservations', () => {
  beforeEach(() => { vi.clearAllMocks(); mock.raw.mockResolvedValue([{ organizationId: 'org-a', day: new Date('2026-11-02'), reservedTokens: 388 }]); mock.execute.mockResolvedValue(1) })
  it('rejects oversized input and excessive output before reaching the database or provider', async () => {
    await expect(reserveAiUsage(runtime, 16001, 32)).rejects.toMatchObject({ code: 'AI_INPUT_TOO_LARGE' })
    await expect(reserveAiUsage(runtime, 10, 2049)).rejects.toMatchObject({ code: 'AI_OUTPUT_TOO_LARGE' })
    expect(mock.raw).not.toHaveBeenCalled()
    expect(mock.fetch).not.toHaveBeenCalled()
  })
  it('reserves the byte bound, message overhead and output atomically with the saved version', async () => {
    const reservation = await reserveAiUsage(runtime, 100, 32)
    expect(reservation).toEqual({ organizationId: 'org-a', day: new Date('2026-11-02'), reservedTokens: 388 })
    const [query, ...values] = mock.raw.mock.calls[0]
    expect(query.join('?')).toMatch(/ON CONFLICT/)
    expect(query.join('?')).toContain('"enabled" = true')
    expect(values).toContain(388)
    expect(values).toContain(version)
    mock.raw.mockResolvedValueOnce([])
    await expect(reserveAiUsage(runtime, 100, 32)).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' })
  })
  it('ignores provider usage outside the database integer range', async () => {
    await finishAiUsage({ organizationId: 'org-a', day: new Date('2026-11-02'), reservedTokens: 388 }, { success: true, totalTokens: 2147483648 })
    const [, ...values] = mock.execute.mock.calls[0]
    expect(values).not.toContain(2147483648)
    expect(values).not.toContain(2147483260)
  })
  it('keeps failed reservations and records only additional actual tokens on the original UTC day', async () => {
    const res = { organizationId: 'org-a', day: new Date('2026-11-02'), reservedTokens: 388 }
    await finishAiUsage(res, { success: false })
    let [, ...values] = mock.execute.mock.calls[0]
    expect(values).toContain(res.day)
    expect(values).toContain(0)
    await finishAiUsage(res, { success: true, totalTokens: 500 })
    ;[, ...values] = mock.execute.mock.calls[1]
    expect(values).toContain(112)
    expect(values).toContain(500)
  })
})
