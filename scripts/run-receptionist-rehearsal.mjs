import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { once } from 'node:events'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanEnvironment, stopChildren } from './rehearsal-safety.mjs'
import { createReadOnlyProxy } from './rehearsal-proxy.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = path.join(root, 'test-results/rehearsal')
mkdirSync(output, { recursive: true })
const log = path.join(output, 'violations.log')
writeFileSync(log, '')
const env = cleanEnvironment(process.env)
const children = new Set()
function run(args, childEnv, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
    ...options,
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}
async function success(child) {
  const [code] = await once(child, 'exit')
  if (code !== 0) throw new Error('Rehearsal subprocess failed.')
}
async function freePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
let proxy
async function stop() {
  await stopChildren(children)
  if (proxy) {
    proxy.closeAllConnections()
    await new Promise((resolve) => proxy.close(resolve))
  }
}
process.once('SIGINT', () => {
  void stop().finally(() => process.exit(130))
})
process.once('SIGTERM', () => {
  void stop().finally(() => process.exit(143))
})
try {
  await success(
    run(
      [
        '--test',
        'scripts/rehearsal-safety.test.mjs',
        'scripts/rehearsal-action-boundary.test.mjs',
        'scripts/rehearsal-keyboard-boundary.test.mjs',
        'scripts/forecast-rehearsal-boundary.test.mjs',
      ],
      env,
    ),
  )
  const port = await freePort(),
    baseURL = `http://127.0.0.1:${port}`
  proxy = createReadOnlyProxy(baseURL, (reason) =>
    appendFileSync(log, `${reason}\n`),
  )
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const proxyPort = proxy.address().port
  const isolatedEnv = {
    ...env,
    REHEARSAL_BASE_URL: baseURL,
    REHEARSAL_PROXY_URL: `http://127.0.0.1:${proxyPort}`,
    REHEARSAL_ALLOWED_PORTS: `${port},${proxyPort}`,
    REHEARSAL_GUARD_LOG: log,
    NODE_OPTIONS: `--import=${new URL('./rehearsal-network-guard.mjs', import.meta.url).href}`,
  }
  await success(
    run(
      ['node_modules/next/dist/bin/next', 'build', 'e2e/rehearsal-app'],
      isolatedEnv,
    ),
  )
  const server = run(
    [
      'node_modules/next/dist/bin/next',
      'start',
      'e2e/rehearsal-app',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    isolatedEnv,
  )
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null)
      throw new Error('Fixture application exited before readiness.')
    try {
      const response = await fetch(`${baseURL}/api/receptionist/home`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      /* Wait for the owned fixture server. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error('Fixture application did not become ready.')
  await success(
    run(
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--config',
        'playwright.rehearsal.config.ts',
      ],
      isolatedEnv,
    ),
  )
  const results = JSON.parse(
    readFileSync(path.join(output, 'results.json'), 'utf8'),
  )
  if (
    results.stats.expected !== 142 ||
    results.stats.unexpected ||
    results.stats.flaky ||
    results.stats.skipped
  )
    throw new Error(
      'Exactly 142 passing, non-skipped, non-retried browser scenarios are required.',
    )
  if (readFileSync(log, 'utf8').trim())
    throw new Error(
      'Network or unmocked-write guard was triggered; see violations.log.',
    )
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Mocked rehearsal failed.',
  )
  process.exitCode = 1
} finally {
  await stop()
  if (readFileSync(log, 'utf8').trim()) {
    console.error('Rehearsal guard log is not empty after shutdown.')
    process.exitCode = 1
  }
}
if (!process.exitCode)
  console.log(
    '142 mocked receptionist browser scenarios passed with no guard violations.',
  )
