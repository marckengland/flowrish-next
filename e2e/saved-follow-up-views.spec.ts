import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'
import type { SavedFollowUpView } from '../src/lib/saved-follow-up-views'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', timezoneId: 'UTC' })
const scope = { organizationId: coreIds.organization, userId: coreIds.user }
const seed: SavedFollowUpView = { id: '11111111-1111-4111-8111-111111111111', name: 'Reviewed callbacks', settings: { status: 'APPROVED', filters: { search: 'Clinic', source: 'CALL', dueOnly: false } }, revision: 1, updatedAt: '2026-11-06T00:00:00.000Z' }
const item = { id: '66666666-6666-4666-8666-666666666666', sourceType: 'EMAIL', sourceText: 'Synthetic saved-view conversation', title: 'Clinic quote', description: 'Synthetic notes', draftSubject: 'Quote', draftBody: 'Synthetic reply', status: 'PENDING', taskId: null, lead: { id: coreIds.lead, firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: '2026-11-06T00:00:00.000Z' }
const state = () => ({ views: [structuredClone(seed)], writes: [] as { method: string; path: string; body: Record<string, unknown> }[], reads: [] as URLSearchParams[], unexpected: [] as string[], lost: false, stale: false, conflict: false })
async function mock(page: Page, base: string, s: ReturnType<typeof state>) {
 const origin = new URL(base).origin
 await page.route('**/*', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method()
  const json = (data: unknown) => route.fulfill({ json: { data, scope: s.stale ? { ...scope, userId: 'other' } : scope, capabilities: { canWrite: true } } })
  if (url.origin !== origin || /receptionist-widget/.test(path)) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
  if (path === '/api/follow-up-views' || /^\/api\/follow-up-views\/[a-f\d-]{36}$/.test(path)) {
   expect(req.headers()['x-flowrish-workspace']).toBe(scope.organizationId); expect(req.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([scope.organizationId, scope.userId]))
   if (method === 'GET' && path === '/api/follow-up-views') { await json(s.views); return }
   if (!['POST', 'PATCH', 'DELETE'].includes(method)) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
   const body = req.postDataJSON(); s.writes.push({ method, path, body })
   if (s.conflict) { s.conflict = false; await route.fulfill({ status: 409, json: { error: { code: 'SAVED_VIEW_CONFLICT', message: 'This saved view changed. Refresh saved views and select it again.' } } }); return }
   if (method === 'DELETE') { s.views = s.views.filter(v => !path.endsWith(v.id)); await json({ deleted: true }); return }
   const id = method === 'POST' ? body.id : path.split('/').at(-1), prior = s.views.find(v => v.id === id)
   const view = { ...(prior ?? seed), ...body, id, revision: method === 'POST' ? 1 : body.expectedRevision + 1 }; delete view.expectedRevision
   s.views = [...s.views.filter(v => v.id !== id), view]
   if (s.lost) { s.lost = false; await route.abort('failed'); return }
   await json(view); return
  }
  if (method === 'GET' && path === '/api/follow-ups') { s.reads.push(new URLSearchParams(url.searchParams)); await json([item]); return }
  if (method === 'GET' && path === '/api/email/matches') { await json([]); return }
  if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
  await route.continue()
 })
}
const region = (p: Page) => p.getByRole('region', { name: 'Saved follow-up views', exact: true })
async function open(p: Page) { await expect(p.getByText(item.sourceText, { exact: true })).toBeVisible(); await p.getByText('Saved views', { exact: true }).click(); await expect(region(p).getByRole('combobox', { name: 'Saved follow-up view', exact: true })).toBeEnabled() }
async function select(p: Page) { await region(p).getByRole('combobox', { name: 'Saved follow-up view', exact: true }).selectOption(seed.id) }
for (const width of [1280, 390]) test(`saved follow-up views preserves filters and mounted drafts through CRUD at ${width}px`, async ({ page, baseURL }, info) => {
 const s = state(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await open(page)
 const filters = page.getByRole('search', { name: 'Follow-up filters', exact: true }); await filters.getByRole('searchbox').fill('Current'); await filters.getByRole('button', { name: 'Apply filters', exact: true }).click(); await expect(page.getByText(item.sourceText, { exact: true })).toBeVisible()
 await page.getByRole('button', { name: 'Review email draft', exact: true }).click(); const subject = page.getByRole('textbox', { name: 'Subject', exact: true }); await subject.fill('Keep saved-view draft'); await subject.evaluate(el => el.setAttribute('data-synthetic-mounted', 'original'))
 await region(page).getByRole('textbox', { name: 'View name', exact: true }).fill('My current view'); await region(page).getByRole('button', { name: 'Save as new view', exact: true }).click(); await expect(region(page)).toContainText('View saved.'); expect(s.writes[0].body.settings).toEqual({ status: 'PENDING', filters: { search: 'Current', source: 'ALL', dueOnly: false } })
 await region(page).getByRole('textbox', { name: 'View name', exact: true }).fill('Renamed view'); await region(page).getByRole('button', { name: 'Rename view', exact: true }).click(); await expect(region(page)).toContainText('Saved view updated.'); await region(page).getByRole('button', { name: 'Replace saved settings', exact: true }).click(); await expect(region(page).getByRole('button', { name: 'Delete saved view', exact: true })).toBeEnabled()
 await region(page).getByRole('button', { name: 'Delete saved view', exact: true }).click(); expect(s.writes).toHaveLength(3); await region(page).getByRole('button', { name: 'Confirm delete saved view', exact: true }).click(); await expect(region(page)).toContainText('Saved view deleted. Your inbox filters and drafts were kept.'); expect(s.writes.map(v => v.method)).toEqual(['POST', 'PATCH', 'PATCH', 'DELETE'])
 await expect(subject).toHaveValue('Keep saved-view draft'); await expect(subject).toHaveAttribute('data-synthetic-mounted', 'original'); await expect(filters.getByRole('searchbox')).toHaveValue('Current'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('saved-follow-up-views.png'), fullPage: true }); expect(s.unexpected).toEqual([])
})
test('saved follow-up views synchronizes another device without navigating or overwriting an unfinished name', async ({ page, context, baseURL }) => {
 const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await open(page); await select(page); await region(page).getByRole('textbox', { name: 'View name', exact: true }).fill('Unfinished rename')
 const second = await context.newPage(); await mock(second, baseURL!, s); await second.goto('/follow-up-access'); await open(second); await select(second); await region(second).getByRole('textbox', { name: 'View name', exact: true }).fill('Other device'); await region(second).getByRole('button', { name: 'Rename view', exact: true }).click(); await expect(region(second)).toContainText('Saved view updated.'); await second.close()
 await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(region(page).getByRole('option', { name: 'Other device', exact: true })).toHaveCount(1); await expect(region(page).getByRole('textbox', { name: 'View name', exact: true })).toHaveValue('Unfinished rename'); await expect(page.getByRole('tab', { name: 'Pending', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect(region(page).getByRole('button', { name: 'Apply view', exact: true })).toBeDisabled(); await region(page).getByRole('button', { name: 'Reload selected view', exact: true }).click(); await expect(region(page).getByRole('textbox', { name: 'View name', exact: true })).toHaveValue('Other device'); expect(s.writes).toHaveLength(1); expect(s.unexpected).toEqual([])
})
test('saved follow-up views retries an uncertain create only explicitly with the same frozen settings', async ({ page, baseURL }) => {
 const s = state(); s.views = []; await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await open(page); await region(page).getByRole('textbox', { name: 'View name', exact: true }).fill('Uncertain'); s.lost = true; await region(page).getByRole('button', { name: 'Save as new view', exact: true }).click(); await expect(region(page).getByRole('button', { name: 'Retry save', exact: true })).toBeEnabled(); expect(s.writes).toHaveLength(1); await region(page).getByRole('button', { name: 'Retry save', exact: true }).click(); await expect(region(page)).toContainText('View saved.'); expect(s.writes).toHaveLength(2); expect(s.writes[1].body).toEqual(s.writes[0].body); expect(s.views).toHaveLength(1); expect(s.unexpected).toEqual([])
})
test('saved follow-up views clears private metadata on a stale-account receipt without writing', async ({ page, baseURL }) => {
 const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await open(page); await select(page); s.stale = true; await region(page).getByRole('button', { name: 'Refresh saved views', exact: true }).click(); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible(); await expect(region(page)).toHaveCount(0); await expect(page.getByText(item.sourceText, { exact: true })).toHaveCount(0); expect(s.writes).toEqual([]); expect(s.unexpected).toEqual([])
})
test('saved follow-up views retains unsent edits after a conflict and guards combined tab/filter application', async ({ page, baseURL }) => {
 const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await open(page); await select(page); await page.getByRole('button', { name: 'Review email draft', exact: true }).click(); await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('Keep conflict edits'); s.conflict = true
 await region(page).getByRole('textbox', { name: 'View name', exact: true }).fill('Conflicting rename'); await region(page).getByRole('button', { name: 'Rename view', exact: true }).click(); await expect(region(page).getByRole('alert')).toContainText('This saved view changed.'); await expect(region(page).getByRole('button', { name: 'Apply view', exact: true })).toBeDisabled(); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Keep conflict edits')
 await expect(region(page).getByRole('button', { name: 'Reload selected view', exact: true })).toBeEnabled(); await region(page).getByRole('button', { name: 'Reload selected view', exact: true }).click(); await region(page).getByRole('button', { name: 'Apply view', exact: true }).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('group', { name: 'Open draft confirmation', exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Keep conflict edits'); await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await region(page).getByRole('button', { name: 'Apply view', exact: true }).click(); await page.getByRole('button', { name: 'Discard and apply view', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Approved', exact: true })).toHaveAttribute('aria-selected', 'true'); await expect.poll(() => s.reads.at(-1)?.toString()).toBe('status=APPROVED&search=Clinic&source=CALL'); expect(s.writes).toHaveLength(1); expect(s.unexpected).toEqual([])
})
