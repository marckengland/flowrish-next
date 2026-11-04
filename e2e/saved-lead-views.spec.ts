import { expect, test, type Browser, type Page } from '@playwright/test'
import { coreIds, coreLead } from './rehearsal-app/core-fixtures'
import type { SavedLeadView } from '../src/lib/saved-lead-views'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const owner = { organizationId: coreIds.organization as string, userId: coreIds.user as string }
function store() { return { rows: new Map<string, SavedLeadView[]>(), writes: [] as Array<{ scope: string; method: string; body: Record<string, unknown> }>, unexpected: [] as string[], uncertain: false, conflict: false, denied: false, accountChanged: false } }
type Store = ReturnType<typeof store>
const key = (scope: typeof owner) => `${scope.organizationId}:${scope.userId}`
async function mock(page: Page, baseURL: string, state: Store, scope = owner) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
    const rows = state.rows.get(key(scope)) ?? []
    const reply = (data: unknown) => route.fulfill({ json: { data, scope } })
    const error = (status: number, message: string) => route.fulfill({ status, json: { error: { message } } })
    if (url.origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path === '/api/lead-views' || path.startsWith('/api/lead-views/')) {
      if (req.headers()['x-flowrish-workspace'] !== scope.organizationId) { state.unexpected.push('Unscoped saved-view request'); await route.abort(); return }
      if (req.headers()['x-flowrish-view-user'] !== (state.accountChanged ? '77777777-7777-4777-8777-777777777777' : scope.userId)) { await route.fulfill({ status: 409, json: { error: { code: 'SAVED_VIEW_CONTEXT_CHANGED', message: 'The account changed. Reload before continuing.' } } }); return }
      if (state.denied) { await error(403, 'Saved-view access revoked.'); return }
      if (method === 'GET') { await reply(rows); return }
      const body = req.postDataJSON(); state.writes.push({ scope: key(scope), method, body })
      if ('organizationId' in body || 'userId' in body) { state.unexpected.push('Client-owned identity'); await route.abort(); return }
      if (method === 'POST') {
        const old = rows.find(row => row.id === body.id)
        const row = old ?? { id: body.id, name: body.name, filters: body.filters, revision: 1, updatedAt: '2026-11-05T00:00:00.000Z' }
        if (!old) { rows.push(row); state.rows.set(key(scope), rows) }
        if (state.uncertain) { state.uncertain = false; await route.abort('failed'); return }
        await reply(row); return
      }
      const index = rows.findIndex(row => row.id === path.split('/').at(-1))
      if (index < 0) { await error(404, 'Saved view not found.'); return }
      if (state.conflict) { state.conflict = false; rows[index] = { ...rows[index], name: 'Other device version', revision: rows[index].revision + 1 }; await error(409, 'This view changed. Refresh saved views and select it again.'); return }
      if (rows[index].revision !== body.expectedRevision) { await error(409, 'View changed. Refresh.'); return }
      if (method === 'DELETE') { rows.splice(index, 1); await reply({ deleted: true }); return }
      if (method === 'PATCH') { rows[index] = { ...rows[index], ...(body.name === undefined ? {} : { name: body.name }), ...(body.filters === undefined ? {} : { filters: body.filters }), revision: rows[index].revision + 1 }; await reply(rows[index]); return }
    }
    if (path === '/api/leads' && method === 'GET') { await route.fulfill({ json: { data: [coreLead()], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } }); return }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
async function otherDevice(browser: Browser, baseURL: string, state: Store, scope = owner) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', proxy: { server: process.env.REHEARSAL_PROXY_URL!, bypass: '<-loopback>' } })
  const page = await context.newPage(); await mock(page, baseURL, state, scope); return { context, page }
}
async function ready(page: Page) { await expect(page.getByRole('button', { name: 'Refresh saved views' })).toBeEnabled() }
async function save(page: Page, name: string) { await page.getByLabel('View name', { exact: true }).fill(name); await expect(page.getByRole('button', { name: 'Save as new view' })).toBeEnabled(); await page.getByRole('button', { name: 'Save as new view' }).click(); await expect(page.getByRole('option', { name, exact: true })).toHaveCount(1) }

for (const width of [1280, 390]) test(`saved lead views supports explicit CRUD and keyboard use at ${width}px`, async ({ page, baseURL }, info) => {
  const state = store(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, state); await page.goto('/leads'); await ready(page)
  await page.getByLabel('Status', { exact: true }).selectOption('NEW'); await page.getByRole('searchbox', { name: 'Search' }).fill('Practice'); await page.getByLabel('View name', { exact: true }).fill('My prospects'); await expect(page.getByRole('button', { name: 'Save as new view' })).toBeEnabled(); await page.getByRole('searchbox', { name: 'Search' }).fill('Practice '); await save(page, 'My prospects')
  expect(state.rows.get(key(owner))?.[0].filters).toEqual({ search: 'Practice', leadStatus: 'NEW' })
  await page.getByRole('button', { name: 'Clear all filters' }).click(); await expect(page.getByRole('button', { name: 'Apply view' })).toBeEnabled(); await page.getByRole('button', { name: 'Apply view' }).focus(); await expect(page.getByRole('button', { name: 'Apply view' })).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('Practice'); await expect(page.getByLabel('Status', { exact: true })).toHaveValue('NEW')
  await page.getByLabel('View name', { exact: true }).fill('Renamed prospects'); await page.getByRole('button', { name: 'Rename view' }).click(); await expect(page.getByRole('option', { name: 'Renamed prospects' })).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search' }).fill('Updated practice'); await expect(page.getByRole('button', { name: 'Replace saved filters' })).toBeEnabled(); await page.getByRole('button', { name: 'Replace saved filters' }).click(); await expect.poll(() => state.rows.get(key(owner))?.[0].filters.search).toBe('Updated practice')
  await page.getByRole('button', { name: 'Delete saved view', exact: true }).click(); expect(state.writes).toHaveLength(3); await page.getByRole('button', { name: 'Confirm delete saved view' }).click(); await expect(page.getByText('No saved views yet.')).toBeVisible(); await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('Updated practice')
  expect(state.writes.map(write => write.method)).toEqual(['POST', 'PATCH', 'PATCH', 'DELETE']); expect(state.unexpected).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('saved-lead-views.png'), fullPage: true })
})
test('saved lead views reloads shared server preferences in a second device without applying automatically', async ({ page, browser, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/leads'); await ready(page); await save(page, 'Across devices')
  const second = await otherDevice(browser, baseURL!, state)
  try {
    await second.page.goto('/leads'); await expect(second.page.getByRole('option', { name: 'Across devices' })).toHaveCount(1); await second.page.getByRole('searchbox', { name: 'Search' }).fill('Keep this search')
    await page.getByLabel('View name', { exact: true }).fill('Changed elsewhere'); await page.getByRole('button', { name: 'Rename view' }).click(); await expect(page.getByRole('option', { name: 'Changed elsewhere' })).toHaveCount(1)
    await second.page.getByRole('button', { name: 'Refresh saved views' }).click(); await expect(second.page.getByRole('option', { name: 'Changed elsewhere' })).toHaveCount(1); await expect(second.page.getByRole('searchbox', { name: 'Search' })).toHaveValue('Keep this search'); expect(state.writes).toHaveLength(2); expect(state.unexpected).toEqual([])
  } finally { await second.context.close() }
})
test('saved lead views preserves the current list when a saved stage is unavailable', async ({ page, baseURL }) => {
  const state = store(); state.rows.set(key(owner), [{ id: coreIds.lead, name: 'Removed stage', filters: { stageId: '99999999-9999-4999-8999-999999999999' }, revision: 1, updatedAt: '2026-11-05T00:00:00.000Z' }]); await mock(page, baseURL!, state); await page.goto('/leads'); await ready(page)
  await page.getByRole('searchbox', { name: 'Search' }).fill('Keep'); await page.getByLabel('Saved lead view', { exact: true }).selectOption(coreIds.lead); await expect(page.getByRole('button', { name: 'Apply view' })).toBeEnabled(); await page.getByRole('button', { name: 'Apply view' }).click(); await expect(page.getByText(/This view uses an unavailable stage/)).toBeVisible(); await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('Keep'); expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('saved lead views retries uncertain saves explicitly and blocks stale overwrites', async ({ page, baseURL }) => {
  const state = store(); state.uncertain = true; await mock(page, baseURL!, state); await page.goto('/leads'); await ready(page); await page.getByLabel('View name', { exact: true }).fill('Uncertain view'); await expect(page.getByRole('button', { name: 'Save as new view' })).toBeEnabled(); await page.getByRole('button', { name: 'Save as new view' }).click(); await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible(); expect(state.writes).toHaveLength(1)
  await page.getByRole('button', { name: 'Retry save' }).click(); await expect(page.getByRole('option', { name: 'Uncertain view' })).toHaveCount(1); expect(state.writes[1].body).toEqual(state.writes[0].body); expect(state.rows.get(key(owner))).toHaveLength(1)
  state.conflict = true; await page.getByLabel('View name', { exact: true }).fill('Stale rename'); await page.getByRole('button', { name: 'Rename view' }).click(); await expect(page.getByText('This view changed. Refresh saved views and select it again.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Rename view' })).toBeDisabled(); expect(state.writes).toHaveLength(3)
  await expect(page.getByRole('option', { name: 'Other device version' })).toHaveCount(1); await page.getByRole('button', { name: 'Reload selected view' }).click(); await page.getByLabel('View name', { exact: true }).fill('Fresh rename'); await page.getByRole('button', { name: 'Rename view' }).click(); await expect(page.getByRole('option', { name: 'Fresh rename' })).toHaveCount(1); expect(state.writes[3].body.expectedRevision).toBe(2); expect(state.unexpected).toEqual([])
})
test('saved lead views isolates users and workspaces and hides preferences after access revocation', async ({ page, browser, baseURL }) => {
  const state = store(); await mock(page, baseURL!, state); await page.goto('/leads'); await ready(page); await save(page, 'Only mine'); await page.getByRole('searchbox', { name: 'Search' }).fill('Private current search')
  for (const [query, scope] of [['other-user', { ...owner, userId: '77777777-7777-4777-8777-777777777777' }], ['other-workspace', { ...owner, organizationId: '66666666-6666-4666-8666-666666666666' }]] as const) {
    const second = await otherDevice(browser, baseURL!, state, scope)
    try { await second.page.goto(`/leads?viewScope=${query}`); await ready(second.page); await expect(second.page.getByText('No saved views yet.')).toBeVisible(); await expect(second.page.getByRole('option', { name: 'Only mine' })).toHaveCount(0); await expect(second.page.getByRole('searchbox', { name: 'Search' })).toHaveValue('') } finally { await second.context.close() }
  }
  await page.getByLabel('View name', { exact: true }).fill('Must not copy to another account'); state.accountChanged = true; await page.getByRole('button', { name: 'Rename view' }).click(); await expect(page.getByText('The account changed. Reload before continuing.')).toBeVisible(); expect(state.writes).toHaveLength(1); expect(state.rows.get(key(owner))?.[0].name).toBe('Only mine'); expect(state.rows.get(key({ ...owner, userId: '77777777-7777-4777-8777-777777777777' })) ?? []).toEqual([]); await expect(page.getByLabel('View name', { exact: true })).toHaveValue('')
  state.accountChanged = false; await page.getByRole('button', { name: 'Reload Leads' }).click(); await ready(page); state.denied = true; await page.getByRole('button', { name: 'Refresh saved views' }).click(); await expect(page.getByText('Saved-view access revoked.')).toBeVisible(); await expect(page.getByRole('option', { name: 'Only mine' })).toHaveCount(0); await expect(page.getByLabel('View name', { exact: true })).toHaveValue(''); await expect(page.getByRole('button', { name: 'Save as new view' })).toBeDisabled(); expect(state.writes).toHaveLength(1); expect(state.unexpected).toEqual([])
})
