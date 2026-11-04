import { expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

it('generates release metadata through the configured production build while retaining Prisma and Next', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'flowrish-build-contract-'))
  try {
    mkdirSync(path.join(root, 'scripts'))
    mkdirSync(path.join(root, 'bin'))
    copyFileSync('package.json', path.join(root, 'package.json'))
    copyFileSync('scripts/write-release-metadata.mjs', path.join(root, 'scripts/write-release-metadata.mjs'))
    const trace = path.join(root, 'trace.txt')
    writeFileSync(path.join(root, 'bin/prisma'), '#!/bin/sh\nprintf "prisma\\n" >> "$SMOKE_TEST_TRACE"\n', { mode: 0o755 })
    writeFileSync(path.join(root, 'bin/next'), '#!/bin/sh\nprintf "next\\n" >> "$SMOKE_TEST_TRACE"\n', { mode: 0o755 })
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const sha = 'd'.repeat(40)
    const result = spawnSync('/bin/sh', ['-c', config.buildCommand], { cwd: root, encoding: 'utf8', env: { NODE_ENV: 'test', PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH, VERCEL_GIT_COMMIT_SHA: sha, SMOKE_TEST_TRACE: trace, npm_config_update_notifier: 'false' } })
    expect(result.status).toBe(0)
    expect(readFileSync(trace, 'utf8')).toBe('prisma\nnext\n')
    expect(existsSync(path.join(root, 'public/release.json'))).toBe(true)
    expect(JSON.parse(readFileSync(path.join(root, 'public/release.json'), 'utf8'))).toEqual({ commit: sha })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
