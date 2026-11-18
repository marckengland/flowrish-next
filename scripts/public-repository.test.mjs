import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(name => name && existsSync(path.join(root, name))))]

test('keeps internal plans, editor state and credential files outside public source', () => {
  const internal = files.filter(name => /^(?:docs\/superpowers\/|\.kiro\/|\.serena\/|\.spec-workflow\/)/.test(name) || /(?:^|\/)\.env(?:\.|$)/.test(name) && name !== '.env.example')
  assert.deepEqual(internal, [])
})
test('public Markdown links resolve and contain no personal filesystem paths', () => {
  const problems = []
  for (const name of files.filter(name => name.endsWith('.md'))) {
    const contents = readFileSync(path.join(root, name), 'utf8')
    if (/\/(?:Users|home)\/[^\s`]+/.test(contents)) problems.push(`${name}: personal filesystem path`)
    for (const match of contents.matchAll(/\[[^\]]+\]\(([^\s)]+)/g)) {
      const target = match[1].replace(/^<|>$/g, '')
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) continue
      const filename = target.split(/[?#]/)[0]
      if (filename && !existsSync(path.resolve(root, path.dirname(name), filename))) problems.push(`${name}: missing ${filename}`)
    }
  }
  assert.deepEqual(problems, [])
})
test('README license and documented npm commands agree with package metadata', () => {
  const metadata = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(metadata.license, 'MIT')
  assert.match(readFileSync(path.join(root, 'LICENSE'), 'utf8'), /^MIT License/)
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
  assert.doesNotMatch(readme, /Private\s*[—-]\s*All rights reserved/i)
  const unknown = []
  for (const name of files.filter(name => name.endsWith('.md'))) for (const match of readFileSync(path.join(root, name), 'utf8').matchAll(/npm run ([a-z\d:_-]+)/gi)) if (!(match[1] in metadata.scripts)) unknown.push(`${name}: ${match[1]}`)
  assert.deepEqual(unknown, [])
})
