import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { docx, pdf } from '../e2e/fixtures/knowledge-files'

const root = process.cwd()
const trace = join(root, '.next/server/app/api/knowledge/extract/route.js.nft.json')
const files = JSON.parse(readFileSync(trace, 'utf8')).files as string[]
const isolated = mkdtempSync(join(tmpdir(), 'flowrish-knowledge-trace-'))
try {
  for (const file of files) {
    const source = resolve(dirname(trace), file)
    const path = relative(root, source)
    assert(!path.startsWith('..') && !isAbsolute(path), 'Trace path must stay inside the project')
    const target = join(isolated, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
  const resolver = createRequire(join(isolated, 'package.json'))
  const worker = join(isolated, 'src/server/services/knowledge-parser-worker.cjs')
  for (const fixture of [
    { format: 'pdf', bytes: pdf('Synthetic trace check costs 99 dollars.'), expected: 'Synthetic trace check costs 99 dollars.' },
    { format: 'docx', bytes: docx('Synthetic trace check offers consultations.'), expected: 'Synthetic trace check offers consultations.' },
  ]) {
    const result = spawnSync(process.execPath, ['--max-old-space-size=192', worker, fixture.format, resolver.resolve('unpdf'), resolver.resolve('mammoth')], {
      cwd: isolated,
      env: { NODE_ENV: 'production' },
      input: fixture.bytes,
      timeout: 15000,
      maxBuffer: 500000,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, `Packaged ${fixture.format} worker must exit successfully`)
    const response = JSON.parse(result.stdout) as { text?: string; error?: string }
    assert.equal(response.error, undefined)
    assert(response.text?.includes(fixture.expected), `Packaged ${fixture.format} worker must extract the synthetic text`)
    console.log(`Packaged ${fixture.format.toUpperCase()} extraction passed using only traced files.`)
  }
} finally {
  rmSync(isolated, { recursive: true, force: true })
}
