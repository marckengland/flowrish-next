import {revealFollowUpFilters} from './helpers/follow-up-filters'
import { expect, test, type Page } from '@playwright/test'
import { coreIds } from './rehearsal-app/core-fixtures'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const context = { organizationId: coreIds.organization, userId: coreIds.user }
const first = { id: '77777777-7777-4777-8777-777777777777', sourceType: 'EMAIL', sourceText: 'First paged synthetic source', title: 'Clinic proposal', description: 'Review availability', draftSubject: 'Proposal', draftBody: 'Synthetic unsent template', status: 'PENDING', taskId: null, lead: { id: coreIds.lead, firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }, createdAt: '2026-11-05T00:00:00.000Z' }
const older = { ...first, id: '88888888-8888-4888-8888-888888888888', sourceText: 'Older paged synthetic source', draftBody: null, createdAt: '2026-11-04T00:00:00.000Z' }
function state() { return { reads: [] as URLSearchParams[], unexpected: [] as string[], fail: false, revoked: false, hold: false, held: false, release: undefined as (() => void) | undefined } }
async function mock(page: Page, baseURL: string, s: ReturnType<typeof state>) {
  const origin = new URL(baseURL).origin
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method(), q = url.searchParams
    if (url.origin !== origin || /receptionist-widget/.test(path) || !['GET', 'HEAD'].includes(method)) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
    if (path === '/api/follow-ups') {
      expect(req.headers()['x-flowrish-workspace']).toBe(context.organizationId)
      expect(req.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([context.organizationId, context.userId]))
      expect(req.headers()['x-flowrish-follow-up-page']).toBe('1')
      s.reads.push(new URLSearchParams(q))
      if (s.hold) { s.hold = false; s.held = true; await new Promise<void>(resolve => { s.release = resolve }) }
      if (s.revoked) { await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Synthetic access revoked' } } }); return }
      if (s.fail && q.has('after')) { s.fail = false; await route.fulfill({ status: 503, json: { error: { code: 'FOLLOW_UP_UNAVAILABLE', message: 'Synthetic page unavailable' } } }); return }
      const replacement = q.get('search') === 'Replacement'
      const rows = replacement ? [{ ...older, sourceText: 'Replacement filtered source' }] : q.has('after') ? [older, first] : [first]
      await route.fulfill({ json: { data: rows, scope: context, capabilities: { canWrite: true }, page: { nextCursor: replacement || q.has('after') ? null : 'cursorA', accessVersion: 'a'.repeat(64) } } }); return
    }
    if (path === '/api/email/matches') { await route.fulfill({ json: { data: [], scope: context, capabilities: { canWrite: true } } }); return }
    if (path.startsWith('/api/')) { s.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
}
const filters = (p: Page) => p.getByRole('search', { name: 'Follow-up filters', exact: true })
const pagination = (p: Page) => p.getByRole('region', { name: 'Follow-up pagination', exact: true })
async function ready(p: Page) { await expect(p.getByText(first.sourceText, { exact: true })).toBeVisible(); await expect(p.getByRole('button', { name: 'Load more', exact: true })).toBeEnabled() }
async function draft(p: Page, value: string) { await p.getByRole('button', { name: 'Review email draft', exact: true }).click(); await p.getByRole('textbox', { name: 'Subject', exact: true }).fill(value) }
for (const width of [1280, 390]) test(`follow-up load more preserves filters and the mounted unsent composer at ${width}px`, async ({ page, baseURL }, info) => {
  const s = state(); await page.setViewportSize({ width, height: 900 }); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await ready(page)
  await revealFollowUpFilters(page); await filters(page).getByRole('searchbox', { name: 'Search follow-ups' }).fill('Clinic')
  await revealFollowUpFilters(page); await filters(page).getByRole('combobox', { name: 'Follow-up source', exact: true }).selectOption('EMAIL')
  await revealFollowUpFilters(page); await filters(page).getByRole('button', { name: 'Apply filters', exact: true }).click(); await ready(page)
  await draft(page, 'Retain these exact unsent edits')
  await page.getByRole('textbox', { name: 'Subject', exact: true }).evaluate(el => { el.setAttribute('data-synthetic-mounted', 'original') })
  const before = s.reads.length; await page.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(page.getByText(older.sourceText, { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Retain these exact unsent edits')
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveAttribute('data-synthetic-mounted', 'original')
  await expect(page.getByText(first.sourceText, { exact: true })).toHaveCount(1)
  await expect(pagination(page)).toContainText('All matching follow-ups are loaded.')
  expect(s.reads.slice(before)).toHaveLength(2)
  for (const q of s.reads.slice(before)) { expect(q.get('search')).toBe('Clinic'); expect(q.get('source')).toBe('EMAIL'); expect(q.getAll('retain')).toContain(first.id) }
  expect(s.reads.at(-1)?.get('after')).toBe('cursorA')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('load-more-draft.png'), fullPage: true }); expect(s.unexpected).toEqual([])
})
test('follow-up load more retains drafts on failure and retries only explicitly', async ({ page, baseURL }) => {
  const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await ready(page); await draft(page, 'Keep after failure'); s.fail = true
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(pagination(page).getByRole('alert')).toHaveText('Synthetic page unavailable')
  await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Keep after failure'); const before = s.reads.length
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(pagination(page).getByRole('button', { name: 'Retry loading', exact: true })).toBeEnabled(); expect(s.reads).toHaveLength(before)
  await pagination(page).getByRole('button', { name: 'Retry loading', exact: true }).click(); await expect(page.getByText(older.sourceText, { exact: true })).toBeVisible()
  expect(s.reads).toHaveLength(before + 2); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Keep after failure'); expect(s.unexpected).toEqual([])
})
test('follow-up load more ignores a delayed response after filters change', async ({ page, baseURL }) => {
  const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await ready(page); s.hold = true
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect.poll(() => s.held).toBe(true)
  await revealFollowUpFilters(page); await filters(page).getByRole('searchbox', { name: 'Search follow-ups' }).fill('Replacement'); await revealFollowUpFilters(page); await filters(page).getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByText('Replacement filtered source', { exact: true })).toBeVisible(); s.release!()
  await expect(page.getByText(first.sourceText, { exact: true })).toHaveCount(0); await expect(page.getByText(older.sourceText, { exact: true })).toHaveCount(0)
  await revealFollowUpFilters(page); await expect(filters(page).getByRole('searchbox', { name: 'Search follow-ups' })).toHaveValue('Replacement'); expect(s.unexpected).toEqual([])
})
test('follow-up load more protects a draft opened during an in-flight page read', async ({ page, baseURL }) => {
  const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await ready(page); s.hold = true
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect.poll(() => s.held).toBe(true)
  await draft(page, 'Opened during loading'); s.release!()
  await expect(pagination(page).getByRole('alert')).toHaveText('The list changed while loading. Retry to continue with your current drafts.')
  await expect(page.getByText(older.sourceText, { exact: true })).toHaveCount(0); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Opened during loading')
  await pagination(page).getByRole('button', { name: 'Retry loading', exact: true }).click(); await expect(page.getByText(older.sourceText, { exact: true })).toBeVisible()
  expect(s.reads.at(-1)?.getAll('retain')).toContain(first.id); await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Opened during loading'); expect(s.unexpected).toEqual([])
})
test('follow-up load more clears private cards and unsent drafts on fresh access denial', async ({ page, baseURL }) => {
  const s = state(); await mock(page, baseURL!, s); await page.goto('/follow-up-access'); await ready(page); await revealFollowUpFilters(page); await draft(page, 'Private unsent edits'); s.revoked = true
  await page.getByRole('button', { name: 'Load more', exact: true }).click(); await expect(page.getByText('Access changed. Reload before continuing.', { exact: true })).toBeVisible()
  await expect(page.getByText(first.sourceText, { exact: true })).toHaveCount(0); await expect(page.getByRole('form', { name: 'Compose email' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0); await revealFollowUpFilters(page); await expect(filters(page).getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled(); expect(s.unexpected).toEqual([])
})
