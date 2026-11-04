import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const fixture = name => readFileSync(join(root, 'scripts/recovery', name), 'utf8')
const databases = new Set(['postgres', 'source', 'restored', 'control'])
const parseJson = value => {
  try { return JSON.parse(value) } catch { throw new Error('Invalid local drill metadata response.') }
}

/**
 * No caller-supplied database, archive, image, or container target is accepted.
 * @param {{run?: (file: string, args: string[], options: {env: NodeJS.ProcessEnv, input?: string | Buffer, cwd?: string, timeout?: number, maxBuffer?: number, encoding?: BufferEncoding | null}) => {status: number | null, stdout: string | Buffer, stderr: string | Buffer, error?: Error, signal?: string | null}, sleep?: (ms: number) => Promise<void>, log?: (...messages: string[]) => void, parentEnv?: NodeJS.ProcessEnv}} [options]
 */
export async function runRecoveryDrill({ run = spawnSync, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log, parentEnv = process.env } = {}) {
  const started = Date.now()
  const env = { NODE_ENV: 'test' }
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot']) if (parentEnv[key]) env[key] = parentEnv[key]
  const options = { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }
  const call = (file, args, extra = {}) => run(file, args, { ...options, ...extra })
  const requireSuccess = (result, message) => {
    // Subprocess output may contain data. Errors deliberately expose only our fixed labels.
    if (result.status !== 0 || result.error || result.signal) throw new Error(message)
    return result.stdout
  }
  const endpoint = parseJson(requireSuccess(call('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']), 'Cannot inspect Docker context.').trim())
  if (typeof endpoint !== 'string' || !/^unix:\/\/\//.test(endpoint)) throw new Error('A local Unix Docker endpoint is required.')
  const docker = (args, extra) => call('docker', ['--host', endpoint, ...args], extra)
  const image = requireSuccess(docker(['image', 'inspect', 'postgres:17', '--format', '{{.Id}}']), 'An already cached PostgreSQL 17 image is required; no image was pulled.').trim()
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid cached PostgreSQL 17 image identity.')
  const nonce = randomUUID(), name = `flowrish-recovery-${nonce}`
  let container, temporary, report, primaryError, creationAttempted = false
  const verifyOwned = () => {
    const info = parseJson(requireSuccess(docker(['inspect', '--format', '{{json .}}', container || name]), 'Cannot verify drill container ownership.'))
    if (!/^[a-f0-9]{64}$/.test(info.Id) || (container && info.Id !== container) || info.Name !== `/${name}` || info.Config?.Labels?.['flowrish.recovery-drill'] !== nonce) throw new Error('Drill container ownership check failed.')
    if (info.HostConfig?.NetworkMode !== 'none' || Object.keys(info.HostConfig?.PortBindings ?? {}).length || info.HostConfig?.Binds?.length || info.Mounts?.length) throw new Error('Drill container isolation check failed.')
    container = info.Id
  }
  const exec = (args, extra) => { verifyOwned(); return docker(['exec', '-i', container, ...args], extra) }
  const sql = (database, input) => {
    if (!databases.has(database)) throw new Error('Invalid local drill database.')
    return requireSuccess(exec(['psql', '--no-psqlrc', '-h', '127.0.0.1', '-U', 'postgres', '-d', database, '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], { input }), `Local ${database} SQL check failed.`).trim()
  }
  const snapshot = database => {
    const tables = sql(database, fixture('snapshot.sql')).split('\n').filter(Boolean).map(parseJson)
    const catalog = parseJson(sql(database, fixture('catalog.sql')))
    return { tables, rows: tables.reduce((sum, table) => sum + Number(table.rows), 0), data: hash(JSON.stringify(tables)), catalog: hash(JSON.stringify(catalog)), catalogParts: Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, hash(JSON.stringify(value))])) }
  }
  const equal = (before, after, message) => { if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(message) }
  const restore = archive => {
    if (sql('restored', "SELECT count(*) FROM pg_tables WHERE schemaname='public';") !== '0') throw new Error('Restore target must be empty.')
    return exec(['pg_restore', '-h', '127.0.0.1', '-U', 'postgres', '--dbname', 'restored', '--single-transaction', '--exit-on-error', '--no-owner'], { input: archive })
  }
  try {
    temporary = mkdtempSync(join(tmpdir(), 'flowrish-recovery-'))
    cpSync(join(root, 'prisma/schema.prisma'), join(temporary, 'schema.prisma'))
    cpSync(join(root, 'prisma/migrations'), join(temporary, 'migrations'), { recursive: true })
    const config = join(temporary, 'prisma.config.mjs')
    writeFileSync(config, `export default { schema: ${JSON.stringify(join(temporary, 'schema.prisma'))}, engine: 'classic', datasource: { url: process.env.DATABASE_URL, directUrl: process.env.DIRECT_URL } };\n`)
    const dummy = 'postgresql://synthetic:synthetic@127.0.0.1:1/unused'
    requireSuccess(call(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'validate', '--config', config], { cwd: temporary, env: { ...env, DATABASE_URL: dummy, DIRECT_URL: dummy } }), 'Copied Prisma schema validation failed.')
    creationAttempted = true
    container = requireSuccess(docker(['run', '--pull=never', '--detach', '--name', name, '--label', `flowrish.recovery-drill=${nonce}`, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', image]), 'Cannot create isolated drill container.').trim()
    if (!/^[a-f0-9]{64}$/.test(container)) { container = undefined; throw new Error('Invalid drill container identity; inspect local Docker manually.') }
    verifyOwned()
    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (exec(['pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { ready = true; break }
      await sleep(250)
    }
    if (!ready) throw new Error('Isolated PostgreSQL startup failed.')
    const version = sql('postgres', 'SHOW server_version;')
    if (!version.startsWith('17.')) throw new Error('Drill requires PostgreSQL major version 17.')
    sql('postgres', 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE DATABASE source; CREATE DATABASE restored; CREATE DATABASE control;')
    sql('control', "CREATE TABLE sentinel (id integer PRIMARY KEY, marker text NOT NULL); INSERT INTO sentinel VALUES (1,'synthetic-control');")
    const control = snapshot('control')
    const migrations = readdirSync(join(temporary, 'migrations'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    for (const migration of migrations) {
      if (!/^\d{14}_[a-z0-9_]+$/.test(migration)) throw new Error('Unexpected migration name.')
      sql('source', readFileSync(join(temporary, 'migrations', migration, 'migration.sql'), 'utf8'))
    }
    sql('source', `CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0);`)
    for (const migration of migrations) sql('source', `INSERT INTO "_prisma_migrations" (id,checksum,migration_name,finished_at,started_at,applied_steps_count) VALUES ('${randomUUID()}','${hash(readFileSync(join(temporary, 'migrations', migration, 'migration.sql')))}','${migration}','2026-01-01','2026-01-01',1);`)
    sql('source', fixture('seed.sql'))
    sql('source', fixture('verify.sql'))
    const source = snapshot('source'), empty = snapshot('restored')
    const archive = requireSuccess(exec(['pg_dump', '-h', '127.0.0.1', '-U', 'postgres', '--dbname', 'source', '--format=custom', '--no-owner'], { encoding: null }), 'Synthetic pg_dump failed.')
    if (!Buffer.isBuffer(archive) || archive.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Synthetic archive header is invalid.')
    log('Created synthetic archive; checking failure recovery.')
    const corrupt = Buffer.from(archive); corrupt.fill(0, 0, 5)
    if (restore(corrupt).status === 0) throw new Error('Corrupt archive was accepted.')
    equal(empty, snapshot('restored'), 'Corrupt archive changed the restore target.')
    sql('restored', `CREATE SCHEMA drill_guard;
      CREATE FUNCTION drill_guard.interrupt_restore() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands() d JOIN pg_class c ON c.oid=d.objid WHERE d.classid='pg_class'::regclass AND c.relname='Lead') THEN RAISE EXCEPTION 'Synthetic mid-restore failure'; END IF; END $$;
      CREATE EVENT TRIGGER drill_interrupt ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION drill_guard.interrupt_restore();`)
    const interrupted = restore(archive)
    if (interrupted.status === 0 || !String(interrupted.stderr).includes('Synthetic mid-restore failure')) throw new Error('Mid-restore interruption was not exercised.')
    equal(empty, snapshot('restored'), 'Interrupted restore did not roll back all public objects.')
    sql('restored', 'DROP EVENT TRIGGER drill_interrupt; DROP SCHEMA drill_guard CASCADE;')
    const restoreStarted = Date.now()
    requireSuccess(restore(archive), 'Synthetic archive restoration failed.')
    const restoreMs = Date.now() - restoreStarted
    sql('restored', fixture('verify.sql'))
    const restored = snapshot('restored')
    if (JSON.stringify(source) !== JSON.stringify(restored)) {
      const parts = Object.keys(source.catalogParts).filter(key => source.catalogParts[key] !== restored.catalogParts[key])
      throw new Error(`Restored fingerprint differs: data=${source.data !== restored.data}; catalog categories=${parts.join(',')}.`)
    }
    let refused = false
    try { restore(archive) } catch (error) { if (error.message === 'Restore target must be empty.') refused = true; else throw error }
    if (!refused) throw new Error('Nonempty target was not refused.')
    equal(source, snapshot('source'), 'Source database changed during restore.')
    equal(control, snapshot('control'), 'Control database changed during restore.')
    equal(restored, snapshot('restored'), 'Nonempty target probe changed restored records.')
    report = { kind: 'synthetic-only', postgresVersion: version, image, migrations: migrations.length, tables: source.tables.length, syntheticRows: source.rows - migrations.length, ledgerRows: migrations.length, archiveBytes: archive.length, archiveSha256: hash(archive), dataSha256: source.data, catalogSha256: source.catalog, restoreMs, checks: ['all-table-counts-and-digests', 'catalog-definitions-and-access-controls', 'two-tenant-crm-relationships', 'knowledge-draft-published-approval', 'fts-index-and-update-trigger', 'browser-role-denial', 'cross-tenant-knowledge-fk', 'orphan-task-fk', 'widgets-disabled', 'corrupt-archive-rejected', 'interrupted-restore-rolled-back', 'nonempty-target-refused', 'source-and-control-unchanged'] }
  } catch (error) { primaryError = error }
  finally {
    let cleanupFailed = false
    try {
      if (creationAttempted) { verifyOwned(); requireSuccess(docker(['rm', '--force', container]), 'Drill container cleanup failed.') }
    } catch { cleanupFailed = true }
    try { if (temporary) rmSync(temporary, { recursive: true, force: true }) } catch { cleanupFailed = true }
    if (cleanupFailed) throw new Error(`Drill cleanup failed; success withheld. Inspect only owned container ${name}.`)
  }
  if (primaryError) throw primaryError
  report.cleanup = 'removed-owned-container-and-temporary-files'
  report.completedAt = new Date().toISOString()
  report.durationMs = Date.now() - started
  log(`Synthetic recovery drill passed: ${report.tables} tables, ${report.syntheticRows} application rows; cleanup complete.`)
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) { console.error('This drill accepts no arguments or external targets.'); process.exitCode = 1 }
  else {
    // Remove stale success evidence before starting a new CLI run.
    const output = join(root, 'test-results/recovery-drill/report.json')
    rmSync(output, { force: true })
    try {
      const report = await runRecoveryDrill()
      mkdirSync(dirname(output), { recursive: true })
      writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    } catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
