import { X509Certificate } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = 'marckengland/flowrish-next'
const project = 'ilkfauwpjyrqcowlzwtz'
class ReleaseError extends Error {}

/** @param {Record<string, string | undefined>} env @param {'migrate' | 'ready'} phase */
export function validateReleaseContext(env, phase) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) {
    throw new ReleaseError('Production release requires an Actions push to the expected main branch.')
  }
  const required = phase === 'ready' ? ['CI_RESULT', 'BROWSER_RESULT', 'INBOX_PERFORMANCE_RESULT', 'MIGRATE_RESULT'] : ['CI_RESULT', 'BROWSER_RESULT', 'INBOX_PERFORMANCE_RESULT']
  if (required.some(key => env[key] !== 'success')) throw new ReleaseError('Every production prerequisite must explicitly succeed.')
}

/** @param {string | undefined} value */
export function normalizeDatabaseUrl(value) {
  if (!value) throw new ReleaseError('Production database credential is missing.')
  let url
  try { url = new URL(value) } catch { throw new ReleaseError('Production database credential is invalid.') }
  const direct = url.hostname === `db.${project}.supabase.co`
  const session = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${project}`)
  const allowedParameters = new Set(['schema', 'connection_limit', 'connect_timeout', 'pool_timeout', 'pgbouncer', 'statement_cache_size', 'sslmode', 'sslaccept'])
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || (!direct && !session) || (url.port && url.port !== '5432') || url.pathname !== '/postgres' || !url.username || !url.password || [...url.searchParams.keys()].some(key => !allowedParameters.has(key)) || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) {
    throw new ReleaseError('Production database credential must target the intended Flowrish direct/session database.')
  }
  url.searchParams.set('sslmode', 'require')
  url.searchParams.set('sslaccept', 'strict')
  return url.toString()
}

/** @param {Record<string, string | undefined>} env @param {typeof fetch} fetchImpl */
async function verifyCurrentMain(env, fetchImpl) {
  if (!env.GH_TOKEN) throw new ReleaseError('A read-only GitHub token is required to verify current main.')
  let sha
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits/main`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new ReleaseError('GitHub request failed')
    sha = (await response.json()).sha
    if (typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)) throw new ReleaseError('Invalid commit response')
  } catch { throw new ReleaseError('Could not verify current main; production remains blocked.') }
  if (sha !== env.GITHUB_SHA) throw new ReleaseError('This commit is not current main; production remains blocked.')
}

/**
 * @typedef {{cwd: string, env: Record<string, string>, encoding: 'utf8'}} RunOptions
 * @typedef {(file: string, args: string[], options: RunOptions) => {status: number | null, stdout?: string, stderr?: string}} Runner
 * @typedef {{phase: 'migrate' | 'ready', env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, run?: Runner, log?: (message: string) => void}} ReleaseOptions
 */

/** @param {ReleaseOptions} options */
export async function runRelease({ phase, env = process.env, fetchImpl = globalThis.fetch, run = spawnSync, log = console.log }) {
  if (phase !== 'migrate' && phase !== 'ready') throw new ReleaseError('Unknown production release phase.')
  validateReleaseContext(env, phase)
  const databaseUrl = phase === 'migrate' ? normalizeDatabaseUrl(env.PRODUCTION_DATABASE_URL) : null
  await verifyCurrentMain(env, fetchImpl)
  if (phase === 'ready') {
    log(`Production release ready for ${env.GITHUB_SHA}.`)
    return
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const certificatePath = path.join(root, 'scripts/certs/supabase-prod-ca-2021.crt')
  let certificate
  try { certificate = new X509Certificate(readFileSync(certificatePath)) } catch { throw new ReleaseError('The production database root certificate is unavailable.') }
  if (!certificate.ca || certificate.fingerprint256 !== '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA' || Date.now() < Date.parse(certificate.validFrom) || Date.now() >= Date.parse(certificate.validTo)) throw new ReleaseError('The production database root certificate is not trusted or current.')
  const credential = new URL(databaseUrl ?? '')
  credential.searchParams.set('sslcert', certificatePath)
  const require = createRequire(import.meta.url)
  const directory = mkdtempSync(path.join(tmpdir(), 'flowrish-production-prisma-'))
  const configPath = path.join(directory, 'prisma.config.ts')
  // The file contains references to environment variables, never credentials.
  const config = `import { defineConfig, env } from ${JSON.stringify(require.resolve('prisma/config'))};\nexport default defineConfig({schema:${JSON.stringify(path.join(root, 'prisma/schema.prisma'))},migrations:{path:${JSON.stringify(path.join(root, 'prisma/migrations'))}},datasource:{url:env('DATABASE_URL'),directUrl:env('DIRECT_URL')}});\n`
  /** @type {Record<string, string>} */
  const childEnv = { DATABASE_URL: credential.toString(), DIRECT_URL: credential.toString(), CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' }
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot']) if (env[key] !== undefined) childEnv[key] = env[key]
  try {
    writeFileSync(configPath, config, { mode: 0o600 })
    const result = run(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', configPath], { cwd: root, env: childEnv, encoding: 'utf8' })
    if (result.status !== 0) {
      const codes = [...new Set(`${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(/\bP\d{4}\b/g) ?? [])]
      throw new ReleaseError(`Prisma migration deployment failed${codes.length ? ` (${codes.join(', ')})` : ''}.`)
    }
    log('Prisma migration deployment succeeded.')
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const phase = process.argv[2]
  if (phase !== 'migrate' && phase !== 'ready') {
    console.error('Use production-release.mjs migrate or ready.')
    process.exitCode = 1
  } else {
    runRelease({ phase }).catch(error => {
      // All operational errors above use fixed text; never print raw transport output.
      console.error(error instanceof ReleaseError ? error.message : 'Production release failed safely; raw operational details are withheld.')
      process.exitCode = 1
    })
  }
}
