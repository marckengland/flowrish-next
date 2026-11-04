import { expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRecoveryDrill } from '../../scripts/recovery-drill.mjs'

function mockDocker(mode = 'remote') {
  let label = '', name = ''
  const run = vi.fn((file: string, args: string[], options: { env: NodeJS.ProcessEnv; input?: string | Buffer }) => {
    if (file !== 'docker') {
      const config = readFileSync(args[args.indexOf('--config') + 1], 'utf8')
      expect(config).not.toContain('dotenv')
      expect(options.env.DATABASE_URL).toContain('@127.0.0.1:1/')
      expect(options.env.DIRECT_URL).toBe(options.env.DATABASE_URL)
      return { status: 0, stdout: '', stderr: '' }
    }
    if (args.includes('context')) return { status: 0, stdout: JSON.stringify(mode === 'remote' ? 'tcp://remote.example:2375' : 'unix:///tmp/synthetic-docker.sock'), stderr: '' }
    if (args.includes('image')) return { status: mode === 'missing-image' ? 1 : 0, stdout: 'sha256:' + 'a'.repeat(64), stderr: 'synthetic-private-detail' }
    if (args.includes('run')) { label = args[args.indexOf('--label') + 1].split('=')[1]; name = args[args.indexOf('--name') + 1]; return { status: 0, stdout: 'b'.repeat(64), stderr: '' } }
    if (args.includes('inspect')) return { status: 0, stdout: JSON.stringify({ Id: 'b'.repeat(64), Name: '/' + name, Config: { Labels: { 'flowrish.recovery-drill': mode === 'wrong-owner' ? 'other-owner' : label } }, HostConfig: { NetworkMode: mode === 'networked' ? 'bridge' : 'none', PortBindings: null, Binds: null }, Mounts: [] }), stderr: '' }
    if (args.includes('rm')) return { status: mode === 'cleanup-fails' ? 1 : 0, stdout: '', stderr: 'synthetic-private-detail' }
    return { status: 1, stdout: '', stderr: 'synthetic-private-detail' }
  })
  return run
}

it('refuses a remote Docker context before creating a container or reading a database', async () => {
  const run = mockDocker()
  await expect(runRecoveryDrill({ run, log: vi.fn() })).rejects.toThrow(/local Unix Docker/)
  expect(run.mock.calls.some(([, args]) => args.includes('run') || args.includes('exec'))).toBe(false)
})
it('fails closed if PostgreSQL 17 is not already cached, without pulling an image', async () => {
  const run = mockDocker('missing-image')
  await expect(runRecoveryDrill({ run, log: vi.fn() })).rejects.toThrow(/cached PostgreSQL 17/)
  expect(run.mock.calls.some(([, args]) => args.includes('pull') || args.includes('run'))).toBe(false)
})
it.each(['wrong-owner', 'networked'])('never executes SQL in or removes a container that fails ownership/isolation checks: %s', async mode => {
  const run = mockDocker(mode)
  await expect(runRecoveryDrill({ run, log: vi.fn() })).rejects.toThrow(/ownership|isolation|cleanup/i)
  expect(run.mock.calls.some(([, args]) => args.includes('exec') || args.includes('rm'))).toBe(false)
})
it('creates a private container without mounts, ports, credentials, or inherited datasource overrides', async () => {
  const run = mockDocker('startup-fails'), log = vi.fn()
  await expect(runRecoveryDrill({ run, sleep: async () => {}, log, parentEnv: { NODE_ENV: 'test', PATH: process.env.PATH, DATABASE_URL: 'synthetic-forbidden-database', DEEPSEEK_API_KEY: 'synthetic-forbidden-provider', DOCKER_HOST: 'tcp://remote.example:2375', NODE_OPTIONS: 'synthetic-forbidden-hook' } })).rejects.toThrow()
  const create = run.mock.calls.find(([, args]) => args.includes('run'))!
  expect(create[1]).toContain('--pull=never')
  expect(create[1][create[1].indexOf('--network') + 1]).toBe('none')
  expect(create[1]).not.toContain('-p'); expect(create[1]).not.toContain('--mount'); expect(create[1]).not.toContain('-v')
  for (const [file, , options] of run.mock.calls) {
    expect(options.env).not.toHaveProperty('DEEPSEEK_API_KEY'); expect(options.env).not.toHaveProperty('DOCKER_HOST'); expect(options.env).not.toHaveProperty('NODE_OPTIONS')
    if (file === 'docker') expect(options.env).not.toHaveProperty('DATABASE_URL')
  }
  expect(run.mock.calls.some(([, args]) => args.includes('rm'))).toBe(true)
  expect(log.mock.calls.flat().join(' ')).not.toMatch(/synthetic-private-detail|synthetic-forbidden/)
})
it('does not claim success when cleanup fails', async () => {
  const run = mockDocker('cleanup-fails'), log = vi.fn()
  await expect(runRecoveryDrill({ run, sleep: async () => {}, log })).rejects.toThrow(/cleanup/i)
  expect(log.mock.calls.flat().join(' ')).not.toContain('passed')
})

it('redacts malformed Docker metadata instead of exposing subprocess output', async () => {
  const run = vi.fn(() => ({ status: 0, stdout: 'synthetic-private-detail', stderr: '' })), log = vi.fn()
  await expect(runRecoveryDrill({ run, log })).rejects.toThrow('Invalid local drill metadata response.')
  expect(run).toHaveBeenCalledTimes(1)
  expect(log.mock.calls.flat().join(' ')).not.toContain('synthetic-private-detail')
})

it.each(['port', 'mount'])('refuses SQL and removal when inspection detects an unexpected %s', async mode => {
  const base = mockDocker('startup-fails')
  const run = vi.fn((...args: Parameters<typeof base>) => {
    const result = base(...args)
    if (args[1].includes('inspect') && !args[1].includes('image') && !args[1].includes('context')) {
      const info = JSON.parse(result.stdout)
      if (mode === 'port') info.HostConfig.PortBindings = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5432' }] }
      else info.Mounts = [{ Type: 'bind', Source: '/unexpected', Destination: '/unexpected' }]
      return { ...result, stdout: JSON.stringify(info) }
    }
    return result
  })
  await expect(runRecoveryDrill({ run, log: vi.fn() })).rejects.toThrow(/cleanup|isolation/i)
  expect(run.mock.calls.some(([, args]) => args.includes('exec') || args.includes('rm'))).toBe(false)
})

it('cleans up a verified owned container even when its creation command fails after starting it', async () => {
  const base = mockDocker('startup-fails')
  const run = vi.fn((...args: Parameters<typeof base>) => {
    const result = base(...args)
    return args[1].includes('run') ? { ...result, status: 1 } : result
  })
  await expect(runRecoveryDrill({ run, log: vi.fn() })).rejects.toThrow('Cannot create isolated drill container.')
  expect(run.mock.calls.some(([, args]) => args.includes('exec'))).toBe(false)
  expect(run.mock.calls.some(([, args]) => args.includes('rm'))).toBe(true)
  const create = run.mock.calls.find(([, args]) => args.includes('run'))!
  expect(create[1][create[1].indexOf('--tmpfs') + 1]).toBe('/var/lib/postgresql/data:rw,size=512m')
})
