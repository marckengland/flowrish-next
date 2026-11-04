import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @param {{root?: string, sha?: string}} options */
export function writeReleaseMetadata({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), sha = process.env.VERCEL_GIT_COMMIT_SHA } = {}) {
  const commit = typeof sha === 'string' && sha.length === 40 && /^[a-f0-9]+$/.test(sha) ? sha : null
  mkdirSync(path.join(root, 'public'), { recursive: true })
  writeFileSync(path.join(root, 'public/release.json'), JSON.stringify({ commit }) + '\n')
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) writeReleaseMetadata()
