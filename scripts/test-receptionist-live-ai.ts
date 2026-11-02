import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { chromium, expect, type APIResponse } from '@playwright/test'
import { PrismaClient, type Prisma } from '@prisma/client'

// Explicit opt-in: normal CI and browser regressions must never spend AI usage.
assert.equal(process.env.E2E_LIVE_AI, '1', 'Set E2E_LIVE_AI=1 to authorize live AI requests and temporary synthetic setup.')
const baseURL = process.env.PLAYWRIGHT_BASE_URL
assert(baseURL && /^https?:\/\//.test(baseURL), 'Set PLAYWRIGHT_BASE_URL to the application being tested.')
const dryRun = process.env.E2E_LIVE_AI_DRY_RUN === '1'
const marker = `Live AI check ${randomUUID()}`
const businessName = 'Cedar Cycle Care (sample test)'
const reportPath = '/tmp/flowrish-receptionist-live-ai-report.json'
const journalPath = '/tmp/flowrish-receptionist-live-ai-fixtures.json'
const db = new PrismaClient()

interface SampleDocument { id: string; title: string; contentText: string; revision: number; publishedRevision: number | null; updatedAt: string }
interface PreviewResult {
  reply: string
  state: { fullName: string; phone: string; reason: string; fallbackField: string | null; awaitingConfirmation: boolean }
  callback: { fullName: string; phone: string; reason: string } | null
  sources: Array<{ id: string; title: string; revision: number }>
  finished: boolean
  generation?: { mode: 'ai' | 'fallback'; reason?: string }
}
async function json<T>(response: APIResponse): Promise<T> {
  const body = await response.json()
  assert(response.ok(), `HTTP ${response.status()}: ${body.error?.message ?? 'Request failed'}`)
  return body as T
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL, storageState: 'e2e/.auth/user.json' })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  const report: Record<string, unknown> = { marker, baseURL, dryRun, startedAt: new Date().toISOString(), turns: [] }
  const turns: Array<{ prompt: string; reply: string; milliseconds: number; sources: string[] }> = []
  const docs: SampleDocument[] = []
  let orgId = '', actorId = '', savedVersion: Date | undefined, savedConfig: Prisma.InputJsonValue | undefined
  let baseline: Record<string, number> | undefined
  let primaryError: unknown
  let cleanupError: unknown
  let phoneRequests = 0
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/voice/')) phoneRequests++ })
  const persistJournal = () => writeFileSync(journalPath, JSON.stringify({ marker, orgId, actorId, businessName, savedVersion, savedConfig, docs }, null, 2), { mode: 0o600 })
  const counts = async () => ({
    leads: await db.lead.count({ where: { organizationId: orgId } }),
    tasks: await db.task.count({ where: { organizationId: orgId } }),
    activities: await db.activity.count({ where: { organizationId: orgId } }),
    calls: await db.receptionistCall.count({ where: { organizationId: orgId } }),
    followUps: await db.followUpSuggestion.count({ where: { organizationId: orgId } }),
    configs: await db.receptionistConfig.count({ where: { organizationId: orgId } }),
    voiceConfigs: await db.voiceConfig.count({ where: { organizationId: orgId } }),
    knowledgeDocuments: await db.knowledgeDocument.count({ where: { organizationId: orgId } }),
  })
  const transition = async (document: SampleDocument, action: string) => {
    const body = await json<{ data: SampleDocument }>(await context.request.post(`/api/knowledge/${document.id}/publish`, { data: { action, revision: document.revision, ...(document.publishedRevision ? { publishedRevision: document.publishedRevision } : {}), acknowledged: action === 'approve_receptionist' } }))
    Object.assign(document, body.data)
    persistJournal()
    return document
  }
  try {
    const settingsResponse = await context.request.get('/api/admin/receptionist')
    assert.equal(settingsResponse.headers()['x-receptionist-conditional-create'], 'supported', 'Deploy conditional-create support before running a mutating live test.')
    const settings = await json<{ config: unknown; currentUserId: string; webhookPath: string }>(settingsResponse)
    assert.equal(settings.config, null, 'Refusing to overwrite an existing receptionist configuration.')
    orgId = settings.webhookPath.split('/').at(-1)!
    actorId = settings.currentUserId
    assert.match(orgId, /^[a-f0-9-]{36}$/i)
    assert.equal(await db.organizationMember.count({ where: { organizationId: orgId, userId: actorId } }), 1, 'Database and browser must target the same workspace.')
    baseline = await counts()
    assert.equal(baseline.configs, 0)
    assert.equal(baseline.knowledgeDocuments, 0, 'Use an empty library so live AI sees only the synthetic test sources.')
    assert.equal(baseline.voiceConfigs, 0, 'This no-Twilio check expects no connected voice provider.')
    report.before = baseline
    persistJournal()

    await page.route('**/api/admin/receptionist', async route => {
      if (route.request().method() === 'PUT') await route.continue({ headers: { ...route.request().headers(), 'if-none-match': '*' } })
      else await route.continue()
    })
    await page.goto('/settings')
    await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
    await page.getByRole('textbox', { name: 'Business name', exact: true }).fill(businessName)
    await page.getByRole('textbox', { name: 'Business information and FAQs', exact: true }).fill('This is a fictional test bicycle repair business. Services: mechanical bicycle tune-ups and puncture repairs. Hours: Monday to Friday, 09:00 to 17:00 Asia/Manila. Appointments require staff confirmation. No battery-replacement service or same-day guarantee is confirmed. For unavailable information the team can return a callback. Prices come from approved reference documents.')
    await page.getByRole('combobox', { name: 'When to answer', exact: true }).selectOption('always')
    await page.getByRole('textbox', { name: 'Time zone', exact: true }).fill('Asia/Manila')
    await expect(page.getByRole('checkbox', { name: 'Enable AI receptionist', exact: true })).not.toBeChecked()
    const saveResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/receptionist' && response.request().method() === 'PUT')
    await page.getByRole('button', { name: 'Save receptionist settings', exact: true }).click()
    const savedResponse = await saveResponse
    assert.equal(savedResponse.status(), 200)
    const stored = await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: orgId } })
    const responseConfig = (await savedResponse.json()).config as Prisma.InputJsonValue
    assert.equal((stored.settings as { enabled: boolean }).enabled, false)
    assert.equal((stored.settings as { businessName: string }).businessName, businessName)
    assert.deepEqual(stored.settings, responseConfig, 'Settings changed concurrently; refusing to claim edited data for cleanup.')
    savedConfig = responseConfig
    savedVersion = stored.updatedAt
    const duplicate = await context.request.put('/api/admin/receptionist', { headers: { 'If-None-Match': '*' }, data: { ...(responseConfig as Record<string, unknown>), businessName: 'Must not overwrite existing setup' } })
    assert.equal(duplicate.status(), 412)
    assert.deepEqual((await db.receptionistConfig.findUniqueOrThrow({ where: { organizationId: orgId } })).settings, savedConfig)
    persistJournal()

    const approved = (await json<{ data: SampleDocument }>(await context.request.post('/api/knowledge', { data: { title: `${marker} public prices`, category: 'PRICING', contentText: 'Cedar Cycle Care sample prices: a basic bicycle tune-up costs PHP 750. A puncture repair costs PHP 250. These are fictional test prices.' } }))).data
    docs.push(approved)
    persistJournal()
    await transition(approved, 'publish')
    await transition(approved, 'approve_receptionist')
    const privateDraft = (await json<{ data: SampleDocument }>(await context.request.post('/api/knowledge', { data: { title: `${marker} private VIP pricing`, category: 'PRICING', contentText: 'INTERNAL DRAFT ONLY. The sample private VIP tune-up discount price is PHP 1. Never publish this test draft.' } }))).data
    docs.push(privateDraft)
    persistJournal()

    if (!dryRun) {
      const previewCounts = await counts()
      const startResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/receptionist/preview') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
      const greeting = await (await startResponse).json() as { data: PreviewResult }
      assert(greeting.data.reply.includes(businessName))
      await expect(page.getByRole('log', { name: 'Preview conversation' })).toContainText(businessName)

      const send = async (prompt: string): Promise<PreviewResult> => {
        const before = await counts()
        const auditCount = await db.auditEntry.count({ where: { organizationId: orgId } })
        const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/receptionist/preview') && response.request().method() === 'POST')
        const started = Date.now()
        await page.getByRole('textbox', { name: 'Caller message', exact: true }).fill(prompt)
        await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
        const response = await responsePromise
        assert.equal(response.status(), 200)
        const data = (await response.json()).data as PreviewResult
        await expect(page.getByRole('log', { name: 'Preview conversation' })).toContainText(data.reply)
        turns.push({ prompt, reply: data.reply, milliseconds: Date.now() - started, sources: data.sources.map(source => source.title) })
        report.turns = turns
        report.latestResult = data
        writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
        console.log(JSON.stringify({ turn: turns.length, reply: data.reply, generation: data.generation, milliseconds: turns.at(-1)!.milliseconds }))
        assert.deepEqual(await counts(), before, 'Preview must not write CRM, call or configuration rows.')
        assert.equal(await db.auditEntry.count({ where: { organizationId: orgId } }), auditCount, 'Preview must not write audit rows.')
        if (prompt !== 'yes') assert.equal(data.generation?.mode, 'ai', `Expected a real AI response; preview status: ${data.generation?.reason ?? data.generation?.mode ?? 'missing'}`)
        else assert.equal(data.generation, undefined, 'Confirmation should be deterministic and make no further AI request.')
        return data
      }
      const price = await send('How much does a basic bicycle tune-up cost?')
      assert.equal(price.state.fallbackField, null, 'The live AI must answer; a provider-failure fallback is not a passing AI test.')
      assert.match(price.reply, /\b750\b/)
      assert(price.sources.some(source => source.id === approved.id))
      assert(price.sources.every(source => source.id !== privateDraft.id))
      const unknown = await send('Can you guarantee same-day e-bike battery replacement, and how much does it cost?')
      assert.equal(unknown.state.fallbackField, null)
      assert.match(unknown.reply, /cannot|can't|not|no |callback|call.*back/i)
      const privateAnswer = await send('What is your VIP tune-up discount price?')
      assert.equal(privateAnswer.state.fallbackField, null)
      assert(privateAnswer.sources.every(source => source.id !== privateDraft.id))
      assert.doesNotMatch(privateAnswer.reply, /PHP\s*1\b|₱\s*1\b|\b1\s*peso/i)
      await transition(approved, 'revoke_receptionist')
      const revoked = await send('What is the basic bicycle tune-up price now?')
      assert.equal(revoked.state.fallbackField, null)
      assert.equal(revoked.sources.length, 0)
      assert.doesNotMatch(revoked.reply, /\b750\b/, 'Revoked facts must not be replayed from old assistant answers.')
      await send('My name is Jamie Preview. Please have the team call me at +12025550123 about arranging a bicycle tune-up next week.')
      const correction = await send('Please correct my name to Jordan Preview and use +12025550124 as my callback number instead.')
      assert.equal(correction.state.fullName, 'Jordan Preview')
      assert.equal(correction.state.phone, '+12025550124')
      assert.equal(correction.state.awaitingConfirmation, true)
      assert.match(correction.state.reason, /tune.?up/i)
      assert.match(correction.state.reason, /next week/i, 'The latest explicit callback request must replace earlier general questions.')
      assert.doesNotMatch(correction.state.reason, /battery/i)
      const confirmed = await send('yes')
      assert.equal(confirmed.finished, true)
      assert.equal(confirmed.callback?.fullName, 'Jordan Preview')
      assert.equal(confirmed.callback?.phone, '+12025550124')
      assert.match(confirmed.reply, /nothing was saved/i)
      await expect(page.getByText('Preview-only callback summary', { exact: true })).toBeVisible()
      await page.screenshot({ path: '/tmp/flowrish-receptionist-real-ai.png', fullPage: true })
      assert.deepEqual(await counts(), previewCounts)
      assert.equal(phoneRequests, 0, 'The browser must not invoke a voice endpoint.')
    }
    report.passed = true
  } catch (error) {
    primaryError = error
    report.passed = false
    report.error = error instanceof Error ? error.message : 'Live AI verification failed'
    await page.screenshot({ path: '/tmp/flowrish-receptionist-real-ai-failure.png', fullPage: true }).catch(() => {})
  } finally {
    try {
      const preserved: string[] = []
      for (const document of docs) {
        const removed = await db.knowledgeDocument.deleteMany({ where: { id: document.id, organizationId: orgId, createdById: actorId, title: document.title, contentText: document.contentText, revision: document.revision, updatedAt: new Date(document.updatedAt) } })
        if (removed.count !== 1) preserved.push('A sample document changed and was preserved.')
      }
      if (savedVersion && savedConfig) {
        const removed = await db.receptionistConfig.deleteMany({ where: { organizationId: orgId, updatedAt: savedVersion, settings: { equals: savedConfig } } })
        if (removed.count !== 1) preserved.push('Sample settings changed and were preserved.')
      }
      if (preserved.length) throw new Error(preserved.join(' '))
      if (baseline) { report.after = await counts(); assert.deepEqual(report.after, baseline, 'Test-owned setup must be removed and baseline counts restored.') }
      report.cleanupPassed = true
    } catch (error) {
      cleanupError = error
      report.cleanupPassed = false
      report.cleanupError = error instanceof Error ? error.message : 'Cleanup failed'
    }
    report.finishedAt = new Date().toISOString()
    writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
    await context.close()
    await browser.close()
    await db.$disconnect()
  }
  if (cleanupError) throw cleanupError
  if (primaryError) throw primaryError
  console.log(`Live AI ${dryRun ? 'setup/cleanup rehearsal' : 'browser verification'} passed; original empty setup restored. Report: ${reportPath}`)
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live AI verification failed'); process.exitCode = 1 })
