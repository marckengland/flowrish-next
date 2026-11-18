import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const windows = process.platform === 'win32'

function launch({ version = 'v22.0.0', environment = true, installed = true, fail = '', generated = false, otherDirectory = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'flowrish startup '))
  try {
    const fixture = path.join(directory, 'project with spaces')
    const bin = path.join(directory, 'bin')
    mkdirSync(fixture); mkdirSync(bin)
    const script = windows ? 'start.bat' : 'start.sh'
    writeFileSync(path.join(fixture, script), readFileSync(path.join(root, script)))
    writeFileSync(path.join(fixture, '.env.example'), 'EXAMPLE_ONLY=synthetic\n')
    if (environment) writeFileSync(path.join(fixture, '.env'), 'EXAMPLE_ONLY=synthetic\n')
    if (installed) mkdirSync(path.join(fixture, 'node_modules'))
    if (generated) mkdirSync(path.join(fixture, 'src/generated/prisma'), { recursive: true })
    const log = path.join(directory, 'commands.log')
    const stubs = windows ? {
      'node.cmd': `@echo off\r\necho ${version}\r\nexit /b 0\r\n`,
      'npm.cmd': '@echo off\r\necho npm %*>>"%STARTUP_TEST_LOG%"\r\nif "%STARTUP_TEST_FAIL%"=="install" exit /b 41\r\nexit /b 0\r\n',
      'npx.cmd': '@echo off\r\necho npx %*>>"%STARTUP_TEST_LOG%"\r\nif "%STARTUP_TEST_FAIL%"=="generate" if "%*"=="prisma generate" exit /b 42\r\nif "%STARTUP_TEST_FAIL%"=="migrate" if "%*"=="prisma migrate deploy" (echo synthetic migration failure 1>&2 & exit /b 43)\r\nexit /b 0\r\n',
    } : {
      node: `#!/bin/sh\nprintf '%s\\n' '${version}'\n`,
      npm: '#!/bin/sh\nprintf "npm %s\\n" "$*" >> "$STARTUP_TEST_LOG"\n[ "$STARTUP_TEST_FAIL" != install ] || exit 41\n',
      npx: '#!/bin/sh\nprintf "npx %s\\n" "$*" >> "$STARTUP_TEST_LOG"\nif [ "$STARTUP_TEST_FAIL" = generate ] && [ "$*" = "prisma generate" ]; then exit 42; fi\nif [ "$STARTUP_TEST_FAIL" = migrate ] && [ "$*" = "prisma migrate deploy" ]; then echo "synthetic migration failure" >&2; exit 43; fi\n',
    }
    for (const [name, contents] of Object.entries(stubs)) {
      const filename = path.join(bin, name)
      writeFileSync(filename, contents); chmodSync(filename, 0o700)
    }
    const env = { PATH: `${bin}${path.delimiter}${windows ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin'}`, STARTUP_TEST_LOG: log, STARTUP_TEST_FAIL: fail }
    for (const key of ['SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
    const result = spawnSync(windows ? process.env.ComSpec : '/bin/bash', windows ? ['/d', '/c', `call "${path.join(fixture, script)}"`] : [path.join(fixture, script)], { cwd: otherDirectory ? directory : fixture, env, encoding: 'utf8', timeout: 15000 })
    assert.ifError(result.error)
    return { ...result, commands: existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [], environmentCreated: existsSync(path.join(fixture, '.env')) }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

for (const version of ['v20.0.0', 'v24.0.0']) test(`rejects unsupported Node ${version} before dependency or database commands`, () => {
  const result = launch({ version })
  assert.notEqual(result.status, 0); assert.deepEqual(result.commands, [])
})
test('copies a missing environment template and stops before installing or migrating', () => {
  const result = launch({ environment: false, installed: false })
  assert.notEqual(result.status, 0); assert.equal(result.environmentCreated, true); assert.deepEqual(result.commands, [])
})
test('uses the lockfile install and stops if installation fails', () => {
  const result = launch({ installed: false, fail: 'install' })
  assert.notEqual(result.status, 0); assert.deepEqual(result.commands, ['npm ci'])
})
test('always regenerates Prisma and stops on generation failure even with a stale generated directory', () => {
  const result = launch({ fail: 'generate', generated: true })
  assert.notEqual(result.status, 0); assert.deepEqual(result.commands, ['npx prisma generate'])
})
test('stops on migration failure and retains its diagnostic without starting the server', () => {
  const result = launch({ fail: 'migrate' })
  assert.notEqual(result.status, 0); assert.match(result.stderr, /synthetic migration failure/)
  assert.deepEqual(result.commands, ['npx prisma generate', 'npx prisma migrate deploy'])
})
test('starts only after a successful lockfile install, generation and migration', () => {
  const result = launch({ installed: false })
  assert.equal(result.status, 0); assert.deepEqual(result.commands, ['npm ci', 'npx prisma generate', 'npx prisma migrate deploy', 'npm run dev'])
})
test('uses its own project directory when invoked from another directory', () => {
  const result = launch({ otherDirectory: true })
  assert.equal(result.status, 0); assert.deepEqual(result.commands, ['npx prisma generate', 'npx prisma migrate deploy', 'npm run dev'])
})
