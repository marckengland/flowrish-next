import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectId = 'prj_AFfVtIp4EO7TqUmIzBYDzDPI8zeb'
const previousDeployment = 'dpl_23dQXYGhk6Vjzo824J5CfUrzLfXM'
const scope = 'marckenglands-projects'

/** @typedef {(file: string, args: string[], options: {encoding: 'utf8', timeout: number}) => {status: number | null, stdout?: string}} Runner */
/** @param {{run?: Runner, log?: (message: string) => void}} [options] */
export function restoreProductionDeployment({ run = spawnSync, log = console.log } = {}) {
  function currentDeployment() {
    const result = run('vercel', ['api', '/v4/aliases/flowrish.marckengland.com', '--scope', scope, '--raw'], { encoding: 'utf8', timeout: 30_000 })
    if (result.status !== 0) throw new Error('Cannot verify the current production alias; rollback stopped.')
    let alias
    try { alias = JSON.parse(result.stdout ?? '') } catch { throw new Error('Cannot read the production alias; rollback stopped.') }
    if (alias.projectId !== projectId || typeof alias.deploymentId !== 'string') throw new Error('The production alias does not match the recorded Flowrish project.')
    return alias.deploymentId
  }
  if (currentDeployment() === previousDeployment) {
    log('The recorded verified deployment is already serving production.')
    return
  }
  const rollback = run('vercel', ['rollback', previousDeployment, '--scope', scope, '--yes'], { encoding: 'utf8', timeout: 180_000 })
  if (rollback.status !== 0 || currentDeployment() !== previousDeployment) throw new Error('Could not confirm the production rollback; inspect Vercel before retrying.')
  log('Production restored to the recorded verified deployment; release gates remain enabled.')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.CONFIRM_PRODUCTION_ROLLBACK !== 'flowrish-next') {
    console.error('Set CONFIRM_PRODUCTION_ROLLBACK=flowrish-next only after approving this release rollback.')
    process.exitCode = 1
  } else {
    try { restoreProductionDeployment() } catch {
      console.error('Production rollback could not be confirmed. No release gate was removed; inspect Vercel before retrying.')
      process.exitCode = 1
    }
  }
}
