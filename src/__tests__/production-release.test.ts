import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { normalizeDatabaseUrl, runRelease, validateReleaseContext } from '../../scripts/production-release.mjs'
const sha = 'a'.repeat(40)
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'marckengland/flowrish-next', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GH_TOKEN: 'synthetic-github-token', CI_RESULT: 'success', BROWSER_RESULT: 'success', INBOX_PERFORMANCE_RESULT: 'success', MIGRATE_RESULT: 'success', PRODUCTION_DATABASE_URL: 'postgresql://postgres.ilkfauwpjyrqcowlzwtz:synthetic-database-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres' }
const fetchMain = () => vi.fn(async () => new Response(JSON.stringify({ sha }), { status: 200 }))
afterEach(() => vi.restoreAllMocks())

it('allows only the expected Actions push on main', () => {
  expect(() => validateReleaseContext(env, 'ready')).not.toThrow()
  for (const invalid of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'fork/flowrish-next' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_SHA: '' }]) {
    expect(() => validateReleaseContext({ ...env, ...invalid }, 'ready')).toThrow()
  }
})
it('accepts only explicit success, never skipped, canceled, missing, or neutral prerequisites', () => {
  for (const key of ['CI_RESULT', 'BROWSER_RESULT', 'INBOX_PERFORMANCE_RESULT', 'MIGRATE_RESULT']) for (const result of ['failure', 'skipped', 'cancelled', 'neutral', '']) {
    expect(() => validateReleaseContext({ ...env, [key]: result }, 'ready')).toThrow()
  }
  expect(() => validateReleaseContext({ ...env, MIGRATE_RESULT: '' }, 'migrate')).not.toThrow()
})
it('rejects stale commits without invoking migration', async () => {
  const run = vi.fn(), fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sha: 'b'.repeat(40) })))
  await expect(runRelease({ phase: 'migrate', env, fetchImpl, run, log: vi.fn() })).rejects.toThrow(/current main/)
  expect(run).not.toHaveBeenCalled()
})
it('does not fetch or migrate for failed prerequisites', async () => {
  const run = vi.fn(), fetchImpl = fetchMain()
  await expect(runRelease({ phase: 'ready', env: { ...env, BROWSER_RESULT: 'failure' }, fetchImpl, run, log: vi.fn() })).rejects.toThrow()
  expect(run).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled()
})
it('reports the exact current commit only after all prerequisites succeed', async () => {
  const log = vi.fn(), fetchImpl = fetchMain(), run = vi.fn()
  await runRelease({ phase: 'ready', env, fetchImpl, run, log })
  expect(log).toHaveBeenCalledWith(`Production release ready for ${sha}.`)
  expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/marckengland/flowrish-next/commits/main', expect.objectContaining({ redirect: 'error' }))
  expect(run).not.toHaveBeenCalled()
})
it('fails safely on missing tokens, HTTP failures, bad JSON, and transport errors without logging bodies', async () => {
  const log = vi.fn(), run = vi.fn()
  for (const fetchImpl of [vi.fn(async () => new Response('synthetic-private-response', { status: 403 })), vi.fn(async () => new Response('not json')), vi.fn(async () => { throw new Error(env.GH_TOKEN) })]) {
    await expect(runRelease({ phase: 'ready', env, fetchImpl, run, log })).rejects.toThrow(/verify current main/)
  }
  await expect(runRelease({ phase: 'ready', env: { ...env, GH_TOKEN: '' }, fetchImpl: fetchMain(), run, log })).rejects.toThrow()
  expect(log).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled()
})
it('requires the intended session/direct database and TLS with certificate verification', () => {
  const normalized = new URL(normalizeDatabaseUrl(env.PRODUCTION_DATABASE_URL))
  expect(normalized.searchParams.get('sslmode')).toBe('require')
  expect(normalized.searchParams.get('sslaccept')).toBe('strict')
  for (const url of ['', 'bad-url', env.PRODUCTION_DATABASE_URL.replace('ilkfauwpjyrqcowlzwtz', 'other-project'), env.PRODUCTION_DATABASE_URL.replace(':5432/', ':6543/'), env.PRODUCTION_DATABASE_URL + '?host=evil.test', env.PRODUCTION_DATABASE_URL + '?schema=private']) {
    expect(() => normalizeDatabaseUrl(url)).toThrow()
  }
})
it('fails closed on a missing database credential before contacting a database', async () => {
  const run = vi.fn()
  await expect(runRelease({ phase: 'migrate', env: { ...env, PRODUCTION_DATABASE_URL: '' }, fetchImpl: fetchMain(), run, log: vi.fn() })).rejects.toThrow(/credential/)
  expect(run).not.toHaveBeenCalled()
})
it('runs only migrate deploy using temporary explicit config and a minimal child environment', async () => {
  let config = ''
  let configPath = ''
  const run = vi.fn((_file: string, args: string[], options: { env: Record<string, string> }) => {
    configPath = args[args.indexOf('--config') + 1]
    config = readFileSync(configPath, 'utf8')
    expect(args).toContain('deploy'); expect(args).toContain('migrate'); expect(args.join(' ')).not.toContain('synthetic-database-password')
    expect(options.env.DATABASE_URL).toBe(options.env.DIRECT_URL)
    expect(options.env).not.toHaveProperty('GH_TOKEN'); expect(options.env).not.toHaveProperty('DEEPSEEK_API_KEY'); expect(options.env).not.toHaveProperty('NODE_OPTIONS')
    return { status: 0, stdout: 'No pending migrations to apply.', stderr: '' }
  })
  const log = vi.fn()
  await runRelease({ phase: 'migrate', env: { ...env, DEEPSEEK_API_KEY: 'synthetic-unused-provider-key', NODE_OPTIONS: 'synthetic-unused-hook' }, fetchImpl: fetchMain(), run, log })
  expect(config).toContain('migrations'); expect(config).not.toContain('dotenv'); expect(config).not.toContain('synthetic-database-password')
  expect(existsSync(configPath)).toBe(false)
  expect(run).toHaveBeenCalledTimes(1); expect(log).toHaveBeenCalledWith('Prisma migration deployment succeeded.')
})
it('redacts Prisma datasource errors and refuses release when migration fails', async () => {
  const log = vi.fn(), run = vi.fn(() => ({ status: 1, stdout: env.PRODUCTION_DATABASE_URL, stderr: `Error P1001: ${env.GH_TOKEN}` }))
  await expect(runRelease({ phase: 'migrate', env, fetchImpl: fetchMain(), run, log })).rejects.toThrow('Prisma migration deployment failed (P1001).')
  expect(log).not.toHaveBeenCalled()
})
it('uses the bundled public Supabase root instead of weakening certificate verification', async () => {
  const run = vi.fn((_file: string, _args: string[], options: { env: Record<string, string> }) => {
    const url = new URL(options.env.DATABASE_URL)
    const certificate = url.searchParams.get('sslcert')
    expect(certificate).toBeTruthy()
    expect(readFileSync(certificate!, 'utf8')).toContain('-----BEGIN CERTIFICATE-----')
    expect(url.searchParams.get('sslaccept')).toBe('strict')
    return { status: 0, stdout: 'No pending migrations to apply.', stderr: '' }
  })
  await runRelease({ phase: 'migrate', env, fetchImpl: fetchMain(), run, log: vi.fn() })
  expect(run).toHaveBeenCalledTimes(1)
})
it('binds native promotion to the dedicated production-only GitHub check', () => {
  const check = JSON.parse(readFileSync('scripts/production-release-check.json', 'utf8'))
  expect(check).toMatchObject({ name: 'Production release ready', targets: ['production'], blocks: 'deployment-alias', source: { kind: 'git-provider', provider: 'github', externalCheckName: 'Production release ready' } })
  expect(check.timeout).toBeGreaterThanOrEqual(1800)
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  expect(workflow).toContain("'Production release ready' || 'PR release not requested'")
  expect(workflow).toContain('needs: [ci, receptionist-browser, inbox-performance, migrate]')
  expect(workflow).toContain('environment: Production')
  expect(workflow).not.toContain('skip=true')
})

it('never starts hosted-production jobs in a public fork', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  for (const job of ['migrate', 'release-ready', 'production-smoke']) {
    const block = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    expect(block).toBeDefined()
    const condition = block?.split('\n').find(line => line.trim().startsWith('if:'))
    expect(condition).toContain("github.repository == 'marckengland/flowrish-next'")
    expect(condition).toContain("github.ref == 'refs/heads/main'")
    expect(condition).toContain("github.event_name == 'push'")
  }
})
