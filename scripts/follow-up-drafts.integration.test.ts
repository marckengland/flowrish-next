import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

const container = `flowrish-context-drafts-${process.pid}`
let db: PrismaClient
let service: typeof import('../src/server/services/follow-up-drafts')
let databaseStarted = false
const orgId = randomUUID()
const otherOrgId = randomUUID()
const userId = randomUUID()
const strangerId = randomUUID()
let accountId: string
let leadId: string

function docker(...args: string[]) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}
function sql(query: string) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

const external = vi.hoisted(() => ({ conversation: vi.fn(), ai: vi.fn() }))
vi.mock('@/server/services/email-conversation', () => ({ fetchEmailConversation: external.conversation }))
vi.mock('@/server/services/ai', () => ({ generateConversationFollowUp: external.ai }))
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
  service = await import('../src/server/services/follow-up-drafts')
  await db.organization.createMany({ data: [{ id: orgId, name: 'Draft verification', slug: orgId, plan: 'growth' }, { id: otherOrgId, name: 'Control', slug: otherOrgId }] })
  for (const id of [userId, strangerId]) {
    await db.user.create({ data: { id, authId: randomUUID(), name: 'Sync reviewer', email: `${id}@example.invalid` } })
    await db.organizationMember.create({ data: { organizationId: orgId, userId: id } })
  }
  const role = await db.role.create({ data: { name: 'Sync reviewer', organizationId: orgId, hierarchy: 3, permissions: { create: [{ key: 'leads:read' }, { key: 'leads:write' }] } } })
  const team = await db.team.create({ data: { organizationId: orgId, name: 'Mailbox team' } })
  await db.teamMember.create({ data: { userId, teamId: team.id, roleId: role.id } })
  const account = await db.emailAccount.create({ data: { organizationId: orgId, userId, provider: 'gmail', email: 'owner@example.invalid', accessToken: 'synthetic-secret', refreshToken: 'synthetic-refresh', tokenExpiry: new Date() } })
  accountId = account.id
  const pipeline = await db.pipeline.create({ data: { organizationId: orgId, name: 'Draft pipeline', stages: { create: { name: 'New', order: 1 } } }, include: { stages: true } })
  leadId = (await db.lead.create({ data: { organizationId: orgId, assignedUserId: userId, firstName: 'Jane', lastName: 'Smith', email: 'jane@example.invalid', altEmail: 'jane.alt@example.invalid', stageId: pipeline.stages[0].id } })).id
})

afterAll(async () => { if (db) await db.$disconnect(); if (databaseStarted) docker('stop', container) })


const snapshot = () => ({ accountId, provider: 'gmail' as const, threadId: 'conversation-1', subject: 'Project proposal', mailboxEmail: 'owner@example.invalid', recipientEmail: 'jane.alt@example.invalid', fingerprint: 'a'.repeat(64), messages: [{ id: 'source-1', fromEmail: 'jane.alt@example.invalid', toEmails: ['owner@example.invalid'], sentAt: '2026-11-02T00:00:00.000Z', subject: 'Project proposal', text: 'The complete message includes private context absent from preview.', messageId: '<source-1@example.invalid>', references: '<earlier@example.invalid>' }] })
async function suggestion() {
  const sourceId = `source-${randomUUID()}`
  await db.emailMessage.create({ data: { organizationId: orgId, accountId, externalId: sourceId, threadId: 'conversation-1', fromEmail: 'jane.alt@example.invalid', toEmail: 'owner@example.invalid', subject: 'Project proposal', bodyPreview: 'Short preview', sentAt: new Date() } })
  external.conversation.mockResolvedValue({ ...snapshot(), messages: snapshot().messages.map(message => ({ ...message, id: sourceId })) })
  external.ai.mockResolvedValue({ subject: 'Re: Project proposal', body: 'Hi Jane, thank you for the full project details.' })
  return db.followUpSuggestion.create({ data: { organizationId: orgId, assigneeId: userId, leadId, sourceKey: JSON.stringify(['gmail', accountId, sourceId]), sourceType: 'EMAIL', sourceId, sourceThreadId: 'conversation-1', sourceText: 'Short preview', title: 'Review reply', description: 'Follow up', draftSubject: 'Old subject', draftBody: 'Old reviewed draft' } })
}

describe('conversation drafts on disposable PostgreSQL', () => {
  it('stores a version and safe context metadata without creating tasks, activities or storing full conversation bodies', async () => {
    const item = await suggestion()
    const counts = await Promise.all([db.task.count(), db.activity.count()])
    const draft = await service.generateFollowUpDraft(orgId, userId, item.id, 'Answer the scheduling question.')
    expect(draft.body).toBe('Hi Jane, thank you for the full project details.')
    expect(draft.version).toMatch(/^[a-f0-9-]{36}$/i)
    const saved = await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })
    expect(saved.draftVersion).toBe(draft.version)
    expect(saved.draftBody).toBe(draft.body)
    expect(JSON.stringify(saved.draftContext)).not.toContain('private context absent from preview')
    expect(await Promise.all([db.task.count(), db.activity.count()])).toEqual(counts)
  })

  it('rejects another organization or assignee before reading a provider conversation', async () => {
    const item = await suggestion()
    external.conversation.mockClear()
    await expect(service.generateFollowUpDraft(otherOrgId, userId, item.id)).rejects.toThrow()
    await expect(service.generateFollowUpDraft(orgId, strangerId, item.id)).rejects.toThrow()
    expect(external.conversation).not.toHaveBeenCalled()
  })

  it('preserves the previous draft when generation fails', async () => {
    const item = await suggestion()
    external.ai.mockRejectedValueOnce(new Error('Synthetic AI failure'))
    await expect(service.generateFollowUpDraft(orgId, userId, item.id)).rejects.toThrow()
    expect((await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })).draftBody).toBe('Old reviewed draft')
  })

  it('does not overwrite a dismissed suggestion when a slow AI response arrives', async () => {
    const item = await suggestion()
    let release!: (value: { subject: string; body: string }) => void
    let reached!: () => void
    const entered = new Promise<void>(resolve => { reached = resolve })
    external.ai.mockImplementationOnce(() => { reached(); return new Promise(resolve => { release = resolve }) })
    const pending = service.generateFollowUpDraft(orgId, userId, item.id)
    await entered
    await db.followUpSuggestion.update({ where: { id: item.id }, data: { status: 'DISMISSED' } })
    release({ subject: 'Late reply', body: 'Late generation' })
    await expect(pending).rejects.toThrow()
    const saved = await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })
    expect(saved.status).toBe('DISMISSED')
    expect(saved.draftBody).toBe('Old reviewed draft')
  })

  it('binds a reviewed send to the source mailbox and alternate recipient and rejects stale context', async () => {
    const item = await suggestion()
    const draft = await service.generateFollowUpDraft(orgId, userId, item.id)
    const prepared = await service.prepareFollowUpSend(orgId, userId, item.id, draft.version, leadId)
    expect(prepared.threadId).toBe('conversation-1')
    expect(prepared.options.accountId).toBe(accountId)
    expect(prepared.options.recipientEmail).toBe('jane.alt@example.invalid')
    await expect(service.prepareFollowUpSend(orgId, userId, item.id, randomUUID(), leadId)).rejects.toThrow()
    external.conversation.mockResolvedValueOnce({ ...snapshot(), fingerprint: 'b'.repeat(64) })
    await expect(service.prepareFollowUpSend(orgId, userId, item.id, draft.version, leadId)).rejects.toThrow()
  })
  it('allows only one winner when two generations started from the same draft version', async () => {
    const item = await suggestion()
    const releases = new Map<string, (value: { subject: string; body: string }) => void>()
    let entered!: () => void
    const bothEntered = new Promise<void>(resolve => { entered = resolve })
    const slow = (_context: unknown, instructions: string) => new Promise(resolve => { releases.set(instructions, resolve); if (releases.size === 2) entered() })
    external.ai.mockImplementationOnce(slow).mockImplementationOnce(slow)
    const first = service.generateFollowUpDraft(orgId, userId, item.id, 'first')
    const second = service.generateFollowUpDraft(orgId, userId, item.id, 'second')
    await bothEntered
    releases.get('first')!({ subject: 'First winner', body: 'First reviewed draft' })
    const winner = await first
    releases.get('second')!({ subject: 'Late contender', body: 'Must not overwrite the winner' })
    await expect(second).rejects.toThrow()
    const saved = await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })
    expect(saved.draftVersion).toBe(winner.version)
    expect(saved.draftBody).toBe('First reviewed draft')
  })

  it('rejects a draft after lead ownership changes during generation', async () => {
    const item = await suggestion()
    let release!: (value: { subject: string; body: string }) => void
    let reached!: () => void
    const entered = new Promise<void>(resolve => { reached = resolve })
    external.ai.mockImplementationOnce(() => { reached(); return new Promise(resolve => { release = resolve }) })
    const pending = service.generateFollowUpDraft(orgId, userId, item.id)
    await entered
    await db.lead.update({ where: { id: leadId }, data: { assignedUserId: strangerId } })
    release({ subject: 'Late draft', body: 'Access was revoked' })
    try { await expect(pending).rejects.toThrow() }
    finally { await db.lead.update({ where: { id: leadId }, data: { assignedUserId: userId } }) }
    expect((await db.followUpSuggestion.findUniqueOrThrow({ where: { id: item.id } })).draftBody).toBe('Old reviewed draft')
  })

})
