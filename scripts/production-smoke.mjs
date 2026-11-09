import { appendFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const origin = 'https://flowrish.marckengland.com'
class SmokeError extends Error {}

/** @param {Response} response @param {number} limit */
async function readBody(response, limit) {
  if (!response.body) return ''
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let size = 0, text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new SmokeError('Response exceeds the smoke-check size limit.')
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally { reader.releaseLock() }
}

/** @param {typeof fetch} fetchImpl @param {string} pathname */
async function request(fetchImpl, pathname) {
  return fetchImpl(origin + pathname, {
    method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(5000),
  })
}

/** @param {typeof fetch} fetchImpl @param {string} expectedSha @param {string} suffix */
async function servesCommit(fetchImpl, expectedSha, suffix) {
  try {
    const response = await request(fetchImpl, `/release.json?commit=${expectedSha}&${suffix}`)
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel()
      return false
    }
    const metadata = JSON.parse(await readBody(response, 1024))
    return metadata && Object.keys(metadata).length === 1 && metadata.commit === expectedSha
  } catch { return false }
}

/**
 * @typedef {{path: string, status: number}} SmokeResult
 * @typedef {{expectedSha: string | undefined, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<unknown>, attempts?: number, log?: (message: string) => void}} SmokeOptions
 */

/** @param {SmokeOptions} options @returns {Promise<SmokeResult[]>} */
export async function runSmoke({ expectedSha, fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 20, log = console.log }) {
  if (typeof expectedSha !== 'string' || expectedSha.length !== 40 || !/^[a-f0-9]+$/.test(expectedSha)) throw new SmokeError('A valid expected commit is required for production smoke verification.')
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20) throw new SmokeError('Production smoke polling must use one to twenty attempts.')
  let ready = false
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await servesCommit(fetchImpl, expectedSha, `attempt=${attempt}`)) { ready = true; break }
    if (attempt < attempts - 1) {
      log(`Waiting for the expected production commit (${attempt + 1}/${attempts}).`)
      await sleep(10000)
    }
  }
  if (!ready) throw new SmokeError('The expected commit did not become available on the production domain within the polling limit.')

  /** @type {SmokeResult[]} */
  const results = []
  for (const pathname of ['/', '/login', '/dashboard', '/forecast', '/api/forecast', '/api/receptionist/home', '/api/admin/website-receptionist', '/api/follow-ups/11111111-1111-4111-8111-111111111111/compose-draft']) {
    try {
      const response = await request(fetchImpl, pathname)
      if (pathname === '/' || pathname === '/login') {
        if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new SmokeError('Public page did not load.')
        const html = await readBody(response, 262144)
        const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '')
        if (!/\bFlowrish\b/.test(markup) || (pathname === '/login' && (!/<form\b/i.test(markup) || !/<input\b[^>]*\btype=["']email["']/i.test(markup)))) throw new SmokeError('Public page content is unavailable.')
      } else {
        await response.body?.cancel()
        if (pathname.startsWith('/api/')) {
          if (![401, 403].includes(response.status)) throw new SmokeError('Anonymous API access was not denied.')
        } else {
          const location = response.headers.get('location')
          const destination = location ? new URL(location, origin) : null
          if (![302, 303, 307, 308].includes(response.status) || !destination || destination.origin !== origin || destination.pathname !== '/login' || destination.username || destination.password) throw new SmokeError('Protected page did not redirect to local sign-in.')
        }
      }
      results.push({ path: pathname, status: response.status })
    } catch { throw new SmokeError(`Production smoke failed at ${pathname}; response content and transport details are withheld.`) }
  }
  if (!await servesCommit(fetchImpl, expectedSha, 'confirm=1')) throw new SmokeError('The production commit changed or became unavailable during smoke verification.')
  log(`Production smoke passed for ${expectedSha}.`)
  return results
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expectedSha = process.env.SMOKE_EXPECTED_SHA
  /** @param {string} text */
  const recordSummary = text => {
    if (!process.env.GITHUB_STEP_SUMMARY) return
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, text) }
    catch {
      console.error('::error::Could not write the Actions step summary.')
      process.exitCode = 1
    }
  }
  runSmoke({ expectedSha }).then(results => {
    const summary = `## Production smoke passed\n\nCommit: \`${expectedSha}\`\n\n| Path | Status |\n| --- | --- |\n${results.map(result => `| \`${result.path}\` | ${result.status} |`).join('\n')}\n\nAnonymous GET requests only. No forms, business writes, or AI requests.\n`
    recordSummary(summary)
  }).catch(error => {
    const message = error instanceof SmokeError ? error.message : 'Production smoke verification failed; operational details are withheld.'
    console.error(`::error::${message}`)
    recordSummary(`## Production smoke failed\n\n${message}\n`)
    process.exitCode = 1
  })
}
