import { expect, it, vi } from 'vitest'
import { restoreProductionDeployment } from '../../scripts/production-rollback.mjs'
const projectId = 'prj_AFfVtIp4EO7TqUmIzBYDzDPI8zeb'
const baseline = 'dpl_23dQXYGhk6Vjzo824J5CfUrzLfXM'
it('restores the recorded deployment, is idempotent, and never changes other projects or release gates', () => {
  const state = { active: 'synthetic-new-deployment', otherProject: 'untouched', checks: ['production-gate'] }
  const run = vi.fn((_command: string, args: string[]) => {
    if (args[0] === 'api') return { status: 0, stdout: JSON.stringify({ projectId, deploymentId: state.active }) }
    expect(args).toEqual(['rollback', baseline, '--scope', 'marckenglands-projects', '--yes'])
    state.active = baseline
    return { status: 0, stdout: '' }
  })
  const log = vi.fn()
  restoreProductionDeployment({ run, log })
  restoreProductionDeployment({ run, log })
  expect(state).toEqual({ active: baseline, otherProject: 'untouched', checks: ['production-gate'] })
  expect(run.mock.calls.filter(call => call[1][0] === 'rollback')).toHaveLength(1)
  expect(run.mock.calls.some(call => call[1].includes('DELETE'))).toBe(false)
})
it('refuses another project or an unreadable alias before invoking rollback', () => {
  for (const result of [{ status: 0, stdout: JSON.stringify({ projectId: 'other', deploymentId: 'other' }) }, { status: 1, stdout: 'synthetic-private-message' }, { status: 0, stdout: 'bad-json' }]) {
    const run = vi.fn(() => result), log = vi.fn()
    expect(() => restoreProductionDeployment({ run, log })).toThrow()
    expect(run).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled()
  }
})
