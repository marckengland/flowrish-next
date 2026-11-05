import { expect, test, type Page } from '@playwright/test'
import { coreIds, coreLead } from './rehearsal-app/core-fixtures'
import type { BulkLeadPreview, BulkLeadResult } from '../src/lib/bulk-lead-updates'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const secondId = '99999999-9999-4999-8999-999999999999'
function store() { return { leads: [coreLead(), { ...coreLead(), id: secondId, firstName: 'Second' }], previews: new Map<string, BulkLeadPreview>(), receipts: new Map<string, BulkLeadResult>(), calls: [] as Array<{ path: string; body: Record<string, unknown> }>, unexpected: [] as string[], stale: false, denied: false, lost: false, accountChanged: false, applied: 0, options: 0 } }
type Store = ReturnType<typeof store>
async function mock(page: Page, base: string, state: Store) {
  const origin = new URL(base).origin
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
    const scope = { organizationId: coreIds.organization, userId: coreIds.user }
    const reply = (data: unknown) => route.fulfill({ json: { data, scope } })
    const error = (status: number, code: string, message: string) => route.fulfill({ status, json: { error: { code, message } } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path.startsWith('/api/leads/bulk')) {
      if (req.headers()['x-flowrish-workspace'] !== scope.organizationId) { state.unexpected.push('Missing workspace fence'); await route.abort(); return }
      if (state.accountChanged || req.headers()['x-flowrish-bulk-user'] !== scope.userId) { await error(409, 'BULK_CONTEXT_CHANGED', 'The account changed. Reload before continuing.'); return }
      if (state.denied) { await error(403, 'FORBIDDEN', 'Lead access revoked.'); return }
      if (path === '/api/leads/bulk' && method === 'GET') { ++state.options; await reply({ owners: [{ id: coreIds.user, label: 'Practice Owner' }, { id: secondId, label: 'Second Owner' }], ownersTruncated: false }); return }
      if (method !== 'POST' || !['/api/leads/bulk/preview', '/api/leads/bulk/apply'].includes(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
      const body = req.postDataJSON(); state.calls.push({ path, body })
      if ('organizationId' in body || 'userId' in body || 'stageId' in body) { state.unexpected.push('Unexpected mutation field'); await route.abort(); return }
      if (path.endsWith('/preview')) {
        const change = body.change
        const chosen = state.leads.filter(lead => body.leads.some((selected: { id: string }) => selected.id === lead.id))
        if (chosen.length !== body.leads.length) { await error(409, 'BULK_LEADS_CHANGED', 'Refresh leads and prepare a new preview. Nothing was updated.'); return }
        const preview: BulkLeadPreview = { state: 'preview', id: body.id, expiresAt: '2099-01-01T00:00:00.000Z', change, targetLabel: change.value, rows: chosen.map(lead => ({ id: lead.id, label: `${lead.firstName} ${lead.lastName}`, before: change.field === 'leadStatus' ? lead.leadStatus : lead.assignedUserId ?? 'Unassigned', after: change.value, changed: lead[change.field as 'leadStatus' | 'assignedUserId'] !== change.value })) }
        state.previews.set(body.id, preview); await reply(preview); return
      }
      if (body.confirmed !== true || Object.keys(body).sort().join(',') !== 'confirmed,id') { state.unexpected.push('Missing confirmation or extra apply fields'); await route.abort(); return }
      const existing = state.receipts.get(body.id)
      if (existing) { await reply(existing); return }
      if (state.stale) { await error(409, 'BULK_LEADS_CHANGED', 'Refresh leads and prepare a new preview. Nothing was updated.'); return }
      const preview = state.previews.get(body.id)
      if (!preview) { await error(404, 'BULK_PREVIEW_NOT_FOUND', 'Preview not found.'); return }
      const updated = preview.rows.filter(row => row.changed).length
      const receipt: BulkLeadResult = { state: 'applied', id: body.id, updated, unchanged: preview.rows.length - updated, appliedAt: '2026-11-05T01:00:00.000Z' }
      state.leads = state.leads.map(lead => preview.rows.some(row => row.id === lead.id && row.changed) ? { ...lead, [preview.change.field]: preview.change.value, updatedAt: receipt.appliedAt } : lead)
      state.receipts.set(body.id, receipt); ++state.applied
      if (state.lost) { state.lost = false; await route.abort('failed'); return }
      await reply(receipt); return
    }
    if (path === '/api/lead-views' && method === 'GET') { await reply([]); return }
    if (path === '/api/leads' && method === 'GET') { await route.fulfill({ json: { data: state.leads, pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } } }); return }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
async function ready(page: Page) { await expect(page.getByRole('button', { name: 'Refresh saved views' })).toBeEnabled(); await expect(page.getByLabel('Select all leads on this page')).toBeEnabled() }
async function previewAll(page: Page) { await page.getByLabel('Select all leads on this page').check(); await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByRole('list', { name: 'Exact bulk changes' }).getByRole('listitem')).toHaveCount(2) }
async function confirm(page: Page) { await page.getByLabel('I reviewed these exact changes').check(); await page.getByRole('button', { name: 'Confirm bulk update' }).click() }
for (const width of [1280, 390]) test(`bulk lead updates previews and explicitly confirms status changes at ${width}px`, async ({ page, baseURL }, info) => {
  const state = store(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, state); await page.goto('/leads?bulk=enabled'); await ready(page); expect(state.options).toBe(0); expect(state.calls).toEqual([])
  await page.getByLabel('Select all leads on this page').focus(); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByRole('listitem')).toHaveCount(2)
  expect(state.applied).toBe(0); expect(state.calls).toHaveLength(1); await expect(page.getByRole('button', { name: 'Confirm bulk update' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('bulk-preview.png'), fullPage: true })
  await confirm(page); await expect(page.getByText('Updated 2 leads; 0 unchanged.')).toBeVisible(); expect(state.applied).toBe(1); expect(state.calls).toHaveLength(2); expect(state.leads.every(lead => lead.leadStatus === 'QUALIFIED')).toBe(true); expect(state.unexpected).toEqual([])
})
test('bulk lead updates previews owners and counts no-op rows without changing stages', async ({ page, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/leads?bulk=enabled'); await ready(page); await page.getByLabel('Select all leads on this page').check(); await page.getByLabel('Field to update').selectOption('assignedUserId'); await expect(page.getByLabel('New owner')).toBeEnabled(); await page.getByLabel('New owner').selectOption(coreIds.user); await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByText(/0 will change; 2 unchanged/)).toBeVisible(); await confirm(page); await expect(page.getByText('Updated 0 leads; 2 unchanged.')).toBeVisible()
  expect(state.leads.every(lead => lead.stageId === coreLead().stageId)).toBe(true); expect(state.calls[0].body.change).toEqual({ field: 'assignedUserId', value: coreIds.user }); expect(state.unexpected).toEqual([])
})
test('bulk lead updates rejects stale batches and revoked permissions without partial changes', async ({ page, baseURL }) => {
  const state = store(); state.stale = true; await mock(page, baseURL!, state); await page.goto('/leads?bulk=enabled'); await ready(page); await previewAll(page); await confirm(page); await expect(page.getByText('Refresh leads and prepare a new preview. Nothing was updated.')).toBeVisible(); expect(state.applied).toBe(0); expect(state.leads.every(lead => lead.leadStatus === coreLead().leadStatus)).toBe(true)
  await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByRole('listitem')).toHaveCount(2); state.denied = true; await confirm(page); await expect(page.getByText('Lead access revoked.')).toBeVisible(); await expect(page.getByRole('list', { name: 'Exact bulk changes' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Reload Leads' })).toBeVisible(); expect(state.applied).toBe(0); expect(state.calls).toHaveLength(3); expect(state.unexpected).toEqual([])
})
test('bulk lead updates recovers a lost response only by explicitly retrying the same confirmed receipt', async ({ page, baseURL }) => {
  const state = store(); state.lost = true; await mock(page, baseURL!, state); await page.goto('/leads?bulk=enabled'); await ready(page); await previewAll(page); await confirm(page); await expect(page.getByRole('button', { name: 'Retry confirmed request' })).toBeVisible(); expect(state.applied).toBe(1); expect(state.calls).toHaveLength(2); await expect(page.getByRole('button', { name: 'Preview changes' })).toBeDisabled()
  await page.getByRole('button', { name: 'Retry confirmed request' }).click(); await expect(page.getByText('Updated 2 leads; 0 unchanged.')).toBeVisible(); expect(state.calls[2].body).toEqual(state.calls[1].body); expect(state.applied).toBe(1); expect(state.unexpected).toEqual([])
})
test('bulk lead updates clears selections across filters and blocks stale accounts and read-only controls', async ({ page, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/leads?bulk=enabled'); await ready(page); await previewAll(page); await page.getByLabel('Status', { exact: true }).selectOption('NEW'); await expect(page.getByLabel('Select all leads on this page')).not.toBeChecked(); await expect(page.getByRole('button', { name: 'Confirm bulk update' })).toHaveCount(0); expect(state.calls).toHaveLength(1)
  await page.getByLabel('Select all leads on this page').check(); state.accountChanged = true; await page.getByRole('button', { name: 'Preview changes' }).click(); await expect(page.getByText('The account changed. Reload before continuing.')).toBeVisible(); expect(state.calls).toHaveLength(1); expect(state.applied).toBe(0)
  await page.goto('/leads'); await expect(page.getByRole('button', { name: 'Refresh saved views' })).toBeEnabled(); await expect(page.getByLabel('Select all leads on this page')).toHaveCount(0); expect(state.unexpected).toEqual([])
})
