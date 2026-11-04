import { afterEach, expect, it, vi } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { writeReleaseMetadata } from '../../scripts/write-release-metadata.mjs'
import nextConfig from '../../next.config'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'flowrish-release-test-'))
  roots.push(root)
  return root
}
afterEach(() => { roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0; vi.unstubAllEnvs() })

it('publishes only the validated build commit and preserves other public files', () => {
  const root = fixture(), sha = 'a'.repeat(40)
  mkdirSync(path.join(root, 'public'))
  writeFileSync(path.join(root, 'public/keep.txt'), 'untouched')
  vi.stubEnv('AI_API_KEY', 'synthetic-never-published')
  writeReleaseMetadata({ root, sha })
  expect(JSON.parse(readFileSync(path.join(root, 'public/release.json'), 'utf8'))).toEqual({ commit: sha })
  expect(readFileSync(path.join(root, 'public/keep.txt'), 'utf8')).toBe('untouched')
})

it.each(['', 'bad-value', 'A'.repeat(40), 'a'.repeat(40) + '\n'])('never publishes an invalid build value: %j', sha => {
  const root = fixture()
  writeReleaseMetadata({ root, sha })
  expect(JSON.parse(readFileSync(path.join(root, 'public/release.json'), 'utf8'))).toEqual({ commit: null })
})

it('writes unknown metadata for local builds without falling back to another environment value', () => {
  const root = fixture()
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '')
  vi.stubEnv('GITHUB_SHA', 'b'.repeat(40))
  writeReleaseMetadata({ root })
  expect(JSON.parse(readFileSync(path.join(root, 'public/release.json'), 'utf8'))).toEqual({ commit: null })
})

it('runs the real generator CLI with only synthetic environment values', () => {
  const root = fixture(), sha = 'c'.repeat(40)
  mkdirSync(path.join(root, 'scripts'))
  const script = path.join(root, 'scripts/write-release-metadata.mjs')
  copyFileSync('scripts/write-release-metadata.mjs', script)
  const result = spawnSync(process.execPath, [script], { env: { NODE_ENV: 'test', VERCEL_GIT_COMMIT_SHA: sha, AI_API_KEY: 'synthetic-unused' }, encoding: 'utf8' })
  expect(result.status).toBe(0)
  expect(JSON.parse(readFileSync(path.join(root, 'public/release.json'), 'utf8'))).toEqual({ commit: sha })
  expect(existsSync(path.join(root, '.env'))).toBe(false)
  expect(result.stdout + result.stderr).not.toContain('synthetic-unused')
})

it('disables browser and CDN caching for the commit marker', async () => {
  const headers = await nextConfig.headers?.()
  expect(headers).toContainEqual({ source: '/release.json', headers: [
    { key: 'Cache-Control', value: 'no-store' },
    { key: 'CDN-Cache-Control', value: 'no-store' },
    { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
  ] })
})
