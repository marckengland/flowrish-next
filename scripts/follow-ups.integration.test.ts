import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'

const container = `flowrish-followups-${process.pid}`
let db: PrismaClient
let service: typeof import('../src/server/services/follow-ups')
let databaseStarted = false
const orgId = randomUUID()
const otherOrgId = randomUUID()
const userId = randomUUID()
const strangerId = randomUUID()
let leadId: string
let accountId: string
let enrollmentId: string

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
beforeAll(async () => {
  docker('run', '--pull=never', '--rm', '-d', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg16')
  databaseStarted = true
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready.')
  const port = docker('port', container, '5432/tcp').split(':').at(-1)
  process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`
  process.env.DIRECT_URL = process.env.DATABASE_URL
  sql('CREATE ROLE anon; CREATE ROLE authenticated;')
  for (const name of readdirSync('prisma/migrations').sort()) {
    if (name === 'migration_lock.toml') continue
    sql(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
  }
  ;({ prisma: db } = await import('../src/server/db/client'))
  service = await import('../src/server/services/follow-ups')
  await db.organization.createMany({ data: [{ id: orgId, name: 'Inbox test', slug: orgId }, { id: otherOrgId, name: 'Control', slug: otherOrgId }] })
  for (const id of [userId, strangerId]) {
    await db.user.create({ data: { id, authId: randomUUID(), name: 'Reviewer', email: `${id}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId: orgId, userId: id } })
  }
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: 'Test', stages: { create: { name: 'New', order: 1 } } }, include: { stages: true } })
  const lead = await db.lead.create({ data: { organizationId: orgId, firstName: 'Jane', lastName: 'Smith', email: 'jane@example.invalid', stageId: pipeline.stages[0].id } })
  leadId = lead.id
  const account = await db.emailAccount.create({ data: { organizationId: orgId, userId, provider: 'gmail', email: 'owner@example.invalid', accessToken: 'synthetic', refreshToken: 'synthetic', tokenExpiry: new Date() } })
  accountId = account.id
  const cadence = await db.cadence.create({ data: { organizationId: orgId, name: 'Test sequence', status: 'ACTIVE', createdById: userId } })
  const enrollment = await db.cadenceEnrollment.create({ data: { organizationId: orgId, cadenceId: cadence.id, leadId, enrolledById: userId, emailThreadId: 'thread-1', enrolledAt: new Date('2026-01-01') } })
  enrollmentId = enrollment.id
})

afterAll(async () => {
  if (db) await db.$disconnect()
  if (databaseStarted) docker('stop', container)
})

const message = (externalId: string) => ({ externalId, threadId: 'thread-1', fromEmail: 'jane@example.invalid', toEmail: 'owner@example.invalid', subject: 'Re: Introduction', bodyPreview: 'Please call tomorrow.', sentAt: '2026-02-01T00:00:00.000Z' })

describe('follow-up inbox on disposable PostgreSQL', () => {
  it('protects inbox storage from direct public roles', () => {
    expect(sql(`SELECT rowsecurity FROM pg_tables WHERE tablename='FollowUpSuggestion'`)).toBe('t')
    expect(sql(`SELECT has_table_privilege('anon', '\"FollowUpSuggestion\"', 'SELECT'), has_table_privilege('authenticated', '\"FollowUpSuggestion\"', 'TRUNCATE')`)).toBe('f|f')
  })

  it('ignores outbound, old, automatic and unrelated-thread messages', async () => {
    for (const row of [
      { ...message('outbound'), fromEmail: 'owner@example.invalid', toEmail: 'jane@example.invalid' },
      { ...message('old'), sentAt: '2025-01-01T00:00:00.000Z' },
      { ...message('auto'), headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] },
      { ...message('unrelated'), threadId: 'other-thread' },
    ]) await service.reconcileEmailReplies(orgId, accountId, [row])
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe('ACTIVE')
    expect(await db.followUpSuggestion.count()).toBe(0)
  })

  it('stops a replied cadence and creates one suggestion across repeated delivery', async () => {
    await service.reconcileEmailReplies(orgId, accountId, [message('reply-1')])
    await service.reconcileEmailReplies(orgId, accountId, [message('reply-1')])
    const enrollment = await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })
    expect(enrollment.status).toBe('EXITED')
    expect(enrollment.exitReason).toBe('reply_received')
    expect(await db.followUpSuggestion.count()).toBe(1)
    expect(await db.task.count()).toBe(0)
  })

  it('rejects another user or tenant and commits one task under eight concurrent approvals', async () => {
    const item = (await service.listFollowUps(orgId, userId)).items[0]
    await expect(service.reviewFollowUp(otherOrgId, userId, item.id, { action: 'approve' })).rejects.toThrow()
    await expect(service.reviewFollowUp(orgId, strangerId, item.id, { action: 'approve' })).rejects.toThrow()
    await Promise.all(Array.from({ length: 8 }, () => service.reviewFollowUp(orgId, userId, item.id, { action: 'approve', title: 'Call Jane tomorrow', description: 'Reviewed source', dueDate: '2026-11-03T01:00:00.000Z' })))
    expect(await db.task.count()).toBe(1)
    const task = await db.task.findFirstOrThrow()
    expect(task.title).toBe('Call Jane tomorrow')
    expect(task.leadId).toBe(leadId)
    expect(task.assigneeId).toBe(userId)
    expect(await db.task.count({ where: { organizationId: otherOrgId } })).toBe(0)
    expect((await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('APPROVED')
  })

  it('rolls back approval if task creation fails, then dismisses without a task', async () => {
    const item = await db.followUpSuggestion.create({ data: { organizationId: orgId, assigneeId: userId, leadId, sourceKey: 'rollback', sourceType: 'EMAIL', sourceId: 'rollback', sourceText: 'Please call.', title: 'Call Jane', description: 'Review this', draftSubject: 'Following up', draftBody: 'Hello Jane' } })
    sql(`CREATE FUNCTION reject_followup_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic task failure'; END $$; CREATE TRIGGER reject_followup_task BEFORE INSERT ON "Task" FOR EACH ROW EXECUTE FUNCTION reject_followup_task();`)
    try { await expect(service.reviewFollowUp(orgId, userId, item.id, { action: 'approve' })).rejects.toThrow('Synthetic task failure') }
    finally { sql('DROP TRIGGER reject_followup_task ON "Task"; DROP FUNCTION reject_followup_task();') }
    expect((await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('PENDING')
    await service.reviewFollowUp(orgId, userId, item.id, { action: 'dismiss' })
    expect(await db.task.count()).toBe(1)
    expect((await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('DISMISSED')
  })
  it('materializes a callback once and preserves its existing task on approval', async () => {
    const task = await db.task.create({ data: { organizationId: orgId, assigneeId: userId, leadId, title: 'Callback Jane', description: 'Caller confirmed this callback', dueDate: new Date() } })
    await db.receptionistCall.create({ data: { organizationId: orgId, callSid: randomUUID(), status: 'completed', leadId, taskId: task.id, state: {} } })
    const before = await db.task.count()
    const { items: first } = await service.listFollowUps(orgId, userId)
    const { items: second } = await service.listFollowUps(orgId, userId)
    const callbacks = second.filter(row => row.sourceType === 'CALL')
    expect(first.filter(row => row.sourceType === 'CALL')).toHaveLength(1)
    expect(callbacks).toHaveLength(1)
    await service.reviewFollowUp(orgId, userId, callbacks[0].id, { action: 'approve' })
    expect(await db.task.count()).toBe(before)
    expect((await db.followUpSuggestion.findUniqueOrThrow({ where: { id: callbacks[0].id } })).taskId).toBe(task.id)
  })

  it('keeps reply reconciliation atomic on a persistence error and retry', async () => {
    await db.cadenceEnrollment.update({ where: { id: enrollmentId }, data: { status: 'ACTIVE' } })
    sql(`CREATE FUNCTION reject_followup_suggestion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic suggestion failure'; END $$; CREATE TRIGGER reject_followup_suggestion BEFORE INSERT ON "FollowUpSuggestion" FOR EACH ROW EXECUTE FUNCTION reject_followup_suggestion();`)
    try { await expect(service.reconcileEmailReplies(orgId, accountId, [message('retry-reply')])).rejects.toThrow('Synthetic suggestion failure') }
    finally { sql('DROP TRIGGER reject_followup_suggestion ON "FollowUpSuggestion"; DROP FUNCTION reject_followup_suggestion();') }
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe('ACTIVE')
    await Promise.all(Array.from({ length: 8 }, () => service.reconcileEmailReplies(orgId, accountId, [message('retry-reply')])))
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe('EXITED')
    expect(await db.followUpSuggestion.count({ where: { sourceId: 'retry-reply' } })).toBe(1)
  })

  it('retains repeated exit history when a lead replies after re-enrollment', async () => {
    const previous = await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })
    expect(previous.status).toBe('EXITED')
    const fresh = await db.cadenceEnrollment.create({ data: { organizationId: orgId, cadenceId: previous.cadenceId, leadId, enrolledById: userId, status: 'ACTIVE', emailThreadId: 'thread-1', enrolledAt: new Date('2026-01-15') } })
    const paused = await db.cadenceEnrollment.create({ data: { organizationId: orgId, cadenceId: previous.cadenceId, leadId, enrolledById: userId, status: 'PAUSED', emailThreadId: 'thread-1', enrolledAt: new Date('2026-01-16') } })
    await service.reconcileEmailReplies(orgId, accountId, [message('repeat-reply')])
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe('EXITED')
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe('EXITED')
    expect(await db.cadenceEnrollment.count({ where: { organizationId: orgId, cadenceId: previous.cadenceId, leadId, status: 'EXITED' } })).toBe(3)
    expect(await db.followUpSuggestion.count({ where: { sourceId: 'repeat-reply' } })).toBe(1)
  })

  it('retains prior exits when a re-enrolled lead replies again', async () => {
    const exitedBefore = await db.cadenceEnrollment.count({ where: { organizationId: orgId, leadId, status: 'EXITED' } })
    const prior = await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })
    const current = await db.cadenceEnrollment.create({ data: { organizationId: orgId, cadenceId: prior.cadenceId, leadId, enrolledById: userId, emailThreadId: 'thread-2', enrolledAt: new Date('2026-01-01'), status: 'ACTIVE' } })
    await service.reconcileEmailReplies(orgId, accountId, [{ ...message('repeat-enrollment-reply'), threadId: 'thread-2' }])
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: prior.id } })).status).toBe('EXITED')
    expect((await db.cadenceEnrollment.findUniqueOrThrow({ where: { id: current.id } })).status).toBe('EXITED')
    expect(await db.cadenceEnrollment.count({ where: { organizationId: orgId, leadId, status: 'EXITED' } })).toBe(exitedBefore + 1)
  })

})
