import { expect, test, type Page } from '@playwright/test'
import { coreIds, coreLead } from './rehearsal-app/core-fixtures'
import type { MergeResult } from '../src/lib/lead-merge'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const otherId = '99999999-9999-4999-8999-999999999999'
const counts = { Activity: 2, Task: 1, StageTransition: 1, ScoreHistory: 1, LeadContact: 1 }
function store() { return { calls: [] as Array<{ path: string; body: Record<string, unknown> }>, unexpected: [] as string[], receipt: null as MergeResult | null, blockedId: '', lost: false, stale: false, denied: false, accountChanged: false, applied: 0 } }
async function mock(page: Page, baseURL: string, state: ReturnType<typeof store>) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
    const reply = (data: unknown) => route.fulfill({ json: { data, scope: { organizationId: coreIds.organization, userId: coreIds.user } } })
    const error = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message } } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (['/api/duplicates/check', '/api/leads/merge/preview', '/api/leads/merge/apply'].includes(path)) {
      if (method !== 'POST' || req.headers()['x-flowrish-workspace'] !== coreIds.organization || req.headers()['x-flowrish-merge-user'] !== coreIds.user) { state.unexpected.push('Unexpected merge method or identity'); await route.abort(); return }
      if (state.accountChanged) { await error(409, 'MERGE_CONTEXT_CHANGED', 'The account changed. Reload before continuing.'); return }
      if (state.denied) { await error(403, 'FORBIDDEN', 'Merge access revoked.'); return }
      const body = req.postDataJSON(); state.calls.push({ path, body })
      if ('organizationId' in body || 'userId' in body) { state.unexpected.push('Client-owned merge identity'); await route.abort(); return }
      if (path.endsWith('/check')) { expect(body).toEqual({ leadId: coreIds.lead }); await reply([{ leadId: otherId, leadName: 'Other Practice', matchType: 'email', matchValue: 'practice@example.invalid' }]); return }
      if (path.endsWith('/preview')) {
        expect([body.primaryId, body.secondaryId].sort()).toEqual([coreIds.lead, otherId].sort())
        await reply({ state: 'preview', ...body, primaryLabel: body.primaryId === coreIds.lead ? 'Current Practice' : 'Other Practice', secondaryLabel: body.secondaryId === coreIds.lead ? 'Current Practice' : 'Other Practice', expiresAt: '2099-01-01T00:00:00.000Z', fields: [{ key: 'email', label: 'Email', primary: 'keep@example.invalid', secondary: 'archive@example.invalid', different: true }, { key: 'leadStatus', label: 'Lead status', primary: 'QUALIFIED', secondary: 'NEW', different: true }], counts, blockers: body.secondaryId === state.blockedId ? ['Secondary lead has callback handoff links that need a separate workflow migration.'] : [] }); return
      }
      expect(Object.keys(body).sort()).toEqual(['confirmed', 'id']); expect(body.confirmed).toBe(true)
      if (state.stale) { await error(409, 'MERGE_CHANGED', 'The records changed. Prepare a fresh review. Nothing was merged.'); return }
      if (!state.receipt) {
        const preview = state.calls.filter(call => call.path.endsWith('/preview')).at(-1)!.body
        state.receipt = { state: 'applied', id: body.id, primaryId: String(preview.primaryId), secondaryId: String(preview.secondaryId), appliedAt: '2026-11-05T00:00:00.000Z', counts }; ++state.applied
      }
      if (state.lost) { state.lost = false; await route.abort('failed'); return }
      await reply(state.receipt); return
    }
    if (method === 'GET' && path === `/api/email/threads/${coreIds.lead}`) { await route.fulfill({ json: { data: state.applied ? [{ threadId: 'synthetic-thread', messages: [{ id: 'message', externalId: 'external', threadId: 'synthetic-thread', fromEmail: 'archive@example.invalid', toEmail: 'owner@example.invalid', subject: 'Preserved archived conversation', bodyPreview: 'Transferred history', sentAt: '2026-11-05T00:00:00.000Z', isOutbound: false }] }] : [] } }); return }
    if (method === 'GET' && path === `/api/leads/${coreIds.lead}`) { await route.fulfill({ json: { data: coreLead() } }); return }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
async function choose(page: Page) { await page.getByRole('button', { name: 'Check for duplicates' }).click(); await page.getByRole('radio', { name: 'Choose duplicate Other Practice' }).check() }
async function preview(page: Page) { await page.getByRole('button', { name: 'Preview merge' }).click(); await expect(page.getByRole('region', { name: 'Side-by-side lead comparison' })).toBeVisible() }
async function confirm(page: Page) { await page.getByLabel('I reviewed the retained fields, transfers, and archived record').check(); await page.getByRole('button', { name: 'Confirm merge' }).click() }
for (const width of [1280, 390]) test(`safe lead merges reviews and explicitly confirms an archive at ${width}px`, async ({ page, baseURL }, info) => {
  const state = store(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, state); await page.goto('/merge'); expect(state.calls).toEqual([]); await choose(page); await preview(page); expect(state.calls).toHaveLength(2); expect(state.applied).toBe(0); await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeDisabled(); await expect(page.getByText('keep@example.invalid', { exact: true })).toBeVisible(); await expect(page.getByText('archive@example.invalid', { exact: true })).toBeAttached()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('merge-review.png'), fullPage: true }); await page.getByLabel('I reviewed the retained fields, transfers, and archived record').focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Confirm merge' }).focus(); await page.keyboard.press('Enter'); await expect(page).toHaveURL(new RegExp(`/leads/${coreIds.lead}$`)); expect(state.applied).toBe(1); expect(state.calls).toHaveLength(3); await page.goto(`/leads/${coreIds.lead}?mergeHistory=true`); await expect(page.getByText('Preserved archived conversation')).toBeVisible(); await expect(page.getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0); expect(state.unexpected).toEqual([])
})
test('safe lead merges blocks linked-work sources and permits explicitly keeping that record instead', async ({ page, baseURL }) => {
  const state = store(); state.blockedId = otherId; await mock(page, baseURL!, state); await page.goto('/merge'); await choose(page); await preview(page); await expect(page.getByText('Secondary lead has callback handoff links that need a separate workflow migration.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Confirm merge' })).toBeDisabled(); expect(state.applied).toBe(0)
  await page.getByLabel('Lead to keep').selectOption(otherId); await expect(page.getByRole('button', { name: 'Confirm merge' })).toHaveCount(0); await preview(page); await confirm(page); await expect(page).toHaveURL(new RegExp(`/leads/${otherId}$`)); expect(state.receipt?.primaryId).toBe(otherId); expect(state.applied).toBe(1); expect(state.unexpected).toEqual([])
})
test('safe lead merges rejects stale records and revoked permissions without an automatic retry', async ({ page, baseURL }) => {
  const state = store(); state.stale = true; await mock(page, baseURL!, state); await page.goto('/merge'); await choose(page); await preview(page); await confirm(page); await expect(page.getByText('The records changed. Prepare a fresh review. Nothing was merged.')).toBeVisible(); expect(state.applied).toBe(0); expect(state.calls).toHaveLength(3); state.denied = true; await page.getByRole('button', { name: 'Preview merge' }).click(); await expect(page.getByText('Merge access revoked.')).toBeVisible(); await expect(page.getByRole('radio')).toHaveCount(0); expect(state.calls).toHaveLength(3); expect(state.unexpected).toEqual([])
})
test('safe lead merges explicitly replays the same confirmed receipt after response loss', async ({ page, baseURL }) => {
  const state = store(); state.lost = true; await mock(page, baseURL!, state); await page.goto('/merge'); await choose(page); await preview(page); await confirm(page); await expect(page.getByRole('button', { name: 'Retry confirmed merge' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Preview merge' })).toBeDisabled(); expect(state.calls).toHaveLength(3); expect(state.applied).toBe(1); await page.getByRole('button', { name: 'Retry confirmed merge' }).click(); await expect(page).toHaveURL(new RegExp(`/leads/${coreIds.lead}$`)); expect(state.calls[3].body).toEqual(state.calls[2].body); expect(state.applied).toBe(1); expect(state.unexpected).toEqual([])
})
test('safe lead merges hides confirmation for read-only users and blocks stale-account requests', async ({ page, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/merge?readonly=true'); await choose(page); await expect(page.getByText('Merging requires lead read, write, and delete permission.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Preview merge' })).toHaveCount(0); expect(state.calls).toHaveLength(1); await page.goto('/merge'); await choose(page); state.accountChanged = true; await page.getByRole('button', { name: 'Preview merge' }).click(); await expect(page.getByText('The account changed. Reload before continuing.')).toBeVisible(); await expect(page.getByRole('radio')).toHaveCount(0); expect(state.calls).toHaveLength(2); expect(state.applied).toBe(0); expect(state.unexpected).toEqual([])
})
