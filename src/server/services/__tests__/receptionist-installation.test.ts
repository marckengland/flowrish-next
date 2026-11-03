import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ query: vi.fn(), config: vi.fn(), cooldown: vi.fn(), fetchPage: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $queryRaw: mocks.query, websiteReceptionistConfig: { findUnique: mocks.config } } }))
vi.mock('@/lib/upstash/redis', () => ({ redis: { set: mocks.cooldown } }))
vi.mock('../receptionist-installation-fetch', () => ({ fetchInstallationPage: mocks.fetchPage }))
import { checkReceptionistInstallation } from '../receptionist-installation'
const org = 'local-org', user = 'local-user', id = '11111111-1111-4111-8111-111111111111', version = '2026-11-03T00:00:00.000Z', url = 'https://customer.example.com/', app = 'https://flowrish.example.com'
const config = () => ({ publicId: id, allowedOrigins: [new URL(url).origin], enabled: false, updatedAt: new Date(version) })
const input = () => ({ url, expectedUpdatedAt: version })
const run = () => checkReceptionistInstallation(org, user, input(), app)
beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue([{ userId: user, admin: true, crm: false }]); mocks.config.mockImplementation(async () => config()); mocks.cooldown.mockResolvedValue('OK'); mocks.fetchPage.mockResolvedValue({ outcome: 'html', url, html: `<script src="${app}/receptionist-widget.js" data-flowrish-receptionist="${id}" defer></script>` }) })
describe('explicit installation check boundaries', () => {
  it('reads only public website configuration, with a bounded org cooldown and no activation/provider/CRM writes', async () => {
    const result = await run(); expect(result).toMatchObject({ outcome: 'snippet_found', matchingSnippets: 1, detectedSnippets: 1, originAllowed: true, publicId: id, expectedUpdatedAt: version, requestedUrl: url, checkedUrl: url }); expect(mocks.config).toHaveBeenCalledWith({ where: { organizationId: org }, select: { publicId: true, allowedOrigins: true, enabled: true, updatedAt: true } }); expect(mocks.cooldown).toHaveBeenCalledWith(`flowrish:receptionist-install:${org}`, '1', { nx: true, ex: 30 }); expect(mocks.fetchPage).toHaveBeenCalledWith(url, [new URL(url).origin], undefined); expect(JSON.stringify(result)).not.toMatch(/html|apiKey|Ciphertext|allowedOrigins|script src/)
  })
  it('rejects missing membership or local Settings access before touching website settings, cooldown or network', async () => {
    for (const rows of [[], [{ userId: user, admin: false, crm: true }]]) { mocks.query.mockResolvedValue(rows); await expect(run()).rejects.toMatchObject({ statusCode: 403 }) } expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.cooldown).not.toHaveBeenCalled(); expect(mocks.fetchPage).not.toHaveBeenCalled()
  })
  it('requires saved settings and the expected current version before any outbound check', async () => {
    mocks.config.mockResolvedValueOnce(null); await expect(run()).rejects.toMatchObject({ statusCode: 409 }); mocks.config.mockResolvedValueOnce({ ...config(), updatedAt: new Date('2026-11-03T00:01:00Z') }); await expect(run()).rejects.toMatchObject({ statusCode: 409 }); expect(mocks.cooldown).not.toHaveBeenCalled(); expect(mocks.fetchPage).not.toHaveBeenCalled()
  })
  it('returns exact-origin guidance without DNS or cooldown when the website is not saved', async () => {
    const result = await checkReceptionistInstallation(org, user, { ...input(), url: 'https://www.customer.example.com/' }, app); expect(result).toMatchObject({ outcome: 'origin_not_allowed', originAllowed: false, checkedUrl: null }); expect(mocks.cooldown).not.toHaveBeenCalled(); expect(mocks.fetchPage).not.toHaveBeenCalled()
  })
  it('fails closed when cooldown is occupied or unavailable, without sending traffic', async () => {
    mocks.cooldown.mockResolvedValueOnce(null); await expect(run()).rejects.toMatchObject({ statusCode: 429 }); mocks.cooldown.mockRejectedValueOnce(new Error('PRIVATE REDIS CONFIG')); await expect(run()).rejects.toMatchObject({ statusCode: 503 }); expect(mocks.fetchPage).not.toHaveBeenCalled()
  })
  it('rechecks role and configuration after fetching and refuses stale or revoked results', async () => {
    mocks.query.mockResolvedValueOnce([{ userId: user, admin: true, crm: false }]).mockResolvedValueOnce([]); await expect(run()).rejects.toMatchObject({ statusCode: 403 }); mocks.query.mockResolvedValue([{ userId: user, admin: true, crm: false }]); mocks.config.mockResolvedValueOnce(config()).mockResolvedValueOnce({ ...config(), updatedAt: new Date('2026-11-03T00:01:00Z') }); await expect(run()).rejects.toMatchObject({ statusCode: 409 })
  })
  it('does not return fetched page contents, foreign IDs or unsafe diagnostics', async () => {
    const foreign = '22222222-2222-4222-8222-222222222222'; mocks.fetchPage.mockResolvedValueOnce({ outcome: 'html', url, html: `<script src="${app}/receptionist-widget.js" data-flowrish-receptionist="${foreign}"></script><p>PRIVATE PAGE CONTENT</p>` }); const result = await run(); expect(result.outcome).toBe('wrong_widget'); expect(JSON.stringify(result)).not.toMatch(new RegExp(`${foreign}|PRIVATE`)); mocks.fetchPage.mockRejectedValueOnce(new Error('PRIVATE HOST/KEY')); try { await run(); expect.fail('Expected a safe error') } catch (error) { expect(error).toBeInstanceOf(AppError); expect((error as AppError).statusCode).toBe(503); expect((error as Error).message).not.toMatch(/PRIVATE|HOST|KEY/) }
  })
})
