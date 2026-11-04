import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const roots: string[] = []
afterEach(() => { roots.forEach(root => rmSync(root, { recursive: true, force: true })); roots.length = 0 })
function run(mode: 'success' | 'leak' | 'summary-error') {
  const root = mkdtempSync(path.join(tmpdir(), 'flowrish-smoke-cli-'))
  roots.push(root)
  const hook = path.join(root, 'fetch.mjs')
  const summary = mode === 'summary-error' ? path.join(root, 'synthetic-private-directory/summary.md') : path.join(root, 'summary.md')
  mkdirSync(path.join(root, 'empty'))
  writeFileSync(hook, `
    globalThis.fetch = async (input, init) => {
      const url = new URL(input);
      if (url.origin !== 'https://flowrish.marckengland.com' || init.method !== 'GET' || init.redirect !== 'manual') throw new Error('Unsafe request');
      if (url.pathname === '/release.json') return Response.json({commit: '${'a'.repeat(40)}'});
      if (url.pathname === '/' || url.pathname === '/login') return new Response('<html>Flowrish<form><input type="email"></form></html>', {headers:{'Content-Type':'text/html'}});
      if (url.pathname === '/dashboard' || url.pathname === '/forecast') return new Response(null,{status:307,headers:{Location:'/login'}});
      return new Response('synthetic-private-response', {status:${mode === 'leak' ? 200 : 401}});
    };
  `)
  const result = spawnSync(process.execPath, ['--import', hook, 'scripts/production-smoke.mjs'], { encoding: 'utf8', env: { NODE_ENV: 'test', SMOKE_EXPECTED_SHA: 'a'.repeat(40), GITHUB_STEP_SUMMARY: summary, AI_API_KEY: 'synthetic-unused-provider-key' } })
  return { ...result, summary }
}

it('reports successful anonymous verification in the real CLI and Actions summary', () => {
  const result = run('success')
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Production smoke passed for ' + 'a'.repeat(40))
  const summary = readFileSync(result.summary, 'utf8')
  expect(summary).toContain('## Production smoke passed')
  expect(summary).toContain('| `/api/forecast` | 401 |')
  expect(summary).not.toMatch(/synthetic-private-response|synthetic-unused-provider-key/)
})

it('fails the real CLI and Actions summary for an anonymous API access leak without revealing its body', () => {
  const result = run('leak')
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('::error::Production smoke failed at /api/forecast')
  expect(result.stdout + result.stderr).not.toMatch(/synthetic-private-response|synthetic-unused-provider-key|Production smoke passed/)
  expect(readFileSync(result.summary, 'utf8')).toContain('## Production smoke failed')
})

it('fails safely if the Actions summary cannot be written', () => {
  const result = run('summary-error')
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Could not write the Actions step summary.')
  expect(result.stderr).not.toMatch(/synthetic-private-directory|ENOENT|synthetic-unused-provider-key/)
})
