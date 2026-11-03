import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanEnvironment,
  allowedTarget,
  stopChildren,
} from './rehearsal-safety.mjs'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { chromium } from '@playwright/test'
import { createReadOnlyProxy } from './rehearsal-proxy.mjs'

test('shutdown escalates when an owned child ignores SIGTERM', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
    ],
    { env: cleanEnvironment(process.env), stdio: ['ignore', 'pipe', 'ignore'] },
  )
  await once(child.stdout, 'data')
  try {
    await stopChildren(new Set([child]), 50)
    assert.equal(child.signalCode, 'SIGKILL')
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
  }
})

test('keeps only the selected loopback port', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1'])
    assert.equal(allowedTarget(host, 3198, [3198]), true)
  for (const host of [
    'api.deepseek.com',
    'flowrish.marckengland.com',
    '127.0.0.1.evil.example',
    '0.0.0.0',
  ])
    assert.equal(allowedTarget(host, 3198, [3198]), false)
  assert.equal(allowedTarget('127.0.0.1', 5432, [3198]), false)
  assert.equal(allowedTarget('127.0.0.1', NaN, [3198]), false)
})

test('removes inherited credentials, URLs and injected node options', () => {
  const env = cleanEnvironment({
    PATH: '/bin',
    HOME: '/tmp/example',
    DATABASE_URL: 'never-inherit',
    DEEPSEEK_API_KEY: 'never-inherit',
    SUPABASE_SECRET_KEY: 'never-inherit',
    PLAYWRIGHT_BASE_URL: 'https://production.example',
    NODE_OPTIONS: '--require injected',
    CI: 'true',
  })
  assert.deepEqual(env, {
    PATH: '/bin',
    HOME: '/tmp/example',
    CI: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  })
})

test('fixture bundling rejects production server and credential clients', async () => {
  const { default: config } =
    await import('../e2e/rehearsal-app/next.config.mjs')
  const webpack = config.webpack({ resolve: { alias: {} }, plugins: [] })
  let resolve
  webpack.plugins[0].apply({
    hooks: {
      normalModuleFactory: {
        tap: (_name, apply) =>
          apply({
            hooks: {
              beforeResolve: {
                tap: (_hook, check) => {
                  resolve = check
                },
              },
            },
          }),
      },
    },
  })
  for (const request of [
    '@/server/db/client',
    '@prisma/client',
    '@supabase/ssr',
    './src/server/auth/session',
  ]) {
    assert.throws(
      () => resolve({ request, context: process.cwd() }),
      /forbidden/,
    )
  }
  assert.doesNotThrow(() =>
    resolve({
      request: '@/components/receptionist/receptionist-demo',
      context: process.cwd(),
    }),
  )
})

test('native sockets and dotenv reads fail before reaching services', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'flowrish-rehearsal-probe-'))
  const log = path.join(root, 'violations.log'),
    envFile = path.join(root, '.env')
  writeFileSync(envFile, 'SYNTHETIC_VALUE=not-a-credential')
  const env = {
    ...cleanEnvironment(process.env),
    REHEARSAL_ALLOWED_PORTS: '3198',
    REHEARSAL_GUARD_LOG: log,
  }
  for (const expression of [
    "import net from 'node:net'; net.connect({host:'blocked.invalid',port:443})",
    `import fs from 'node:fs'; fs.readFileSync(${JSON.stringify(envFile)})`,
    `import fs from 'node:fs/promises'; await fs.readFile(${JSON.stringify(envFile)})`,
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        new URL('./rehearsal-network-guard.mjs', import.meta.url).href,
        '--input-type=module',
        '-e',
        expression,
      ],
      { env, encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Rehearsal guard:/)
  }
  const example = path.join(root, '.env.example')
  writeFileSync(example, 'SYNTHETIC_TEMPLATE=example')
  const allowed = spawnSync(
    process.execPath,
    [
      '--import',
      new URL('./rehearsal-network-guard.mjs', import.meta.url).href,
      '--input-type=module',
      '-e',
      `import fs from 'node:fs'; fs.readFileSync(${JSON.stringify(example)})`,
    ],
    { env, encoding: 'utf8' },
  )
  assert.equal(allowed.status, 0)
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 3)
})

test('Chromium proxy allows fixture reads but blocks writes and external traffic', async () => {
  let writes = 0
  const target = http.createServer((request, response) => {
    if (request.method !== 'GET') writes++
    response.end('<html><body>Fixture</body></html>')
  })
  target.listen(0, '127.0.0.1')
  await once(target, 'listening')
  const baseURL = `http://127.0.0.1:${target.address().port}`
  const violations = []
  const proxy = createReadOnlyProxy(baseURL, (value) => violations.push(value))
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  let browser
  try {
    browser = await chromium.launch({
      proxy: {
        server: `http://127.0.0.1:${proxy.address().port}`,
        bypass: '<-loopback>',
      },
    })
    const page = await browser.newPage()
    await page.goto(baseURL)
    assert.equal(
      await page.evaluate(() =>
        fetch('/api/email/send', { method: 'POST' }).then((r) => r.status),
      ),
      403,
    )
    await page.goto('http://blocked.invalid').catch(() => {})
    assert.equal(writes, 0)
    assert.equal(violations.length, 2)
  } finally {
    await browser?.close()
    proxy.closeAllConnections()
    target.closeAllConnections()
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => target.close(resolve)),
    ])
  }
})
