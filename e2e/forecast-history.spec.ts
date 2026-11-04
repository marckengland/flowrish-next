import { expect, test, type BrowserContext } from '@playwright/test'
import { forecastHistoryReport } from './rehearsal-app/forecast-history-fixtures'
import { WORKSPACE_HEADER } from '../src/lib/workspace-context'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
async function mock(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin
  let release!: () => void
  const state = { failed: false, empty: false, hold: false, started: false, reads: 0, unexpected: [] as string[], release: () => release?.() }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) || /receptionist-widget/.test(url.pathname)) { state.unexpected.push(`${request.method()} ${url.pathname}`); await route.abort(); return }
    if (url.pathname === '/api/forecast/history') {
      if (url.search || request.headers()[WORKSPACE_HEADER] !== '99999999-9999-4999-8999-999999999999') { state.unexpected.push('Unbound history read'); await route.abort(); return }
      state.reads++; state.started = true
      if (state.hold) await new Promise<void>(resolve => { release = resolve })
      if (state.failed) await route.fulfill({ status: 503, json: { error: { message: 'Synthetic history unavailable' } } })
      else await route.fulfill({ json: { data: { ...forecastHistoryReport, snapshots: state.empty ? [] : forecastHistoryReport.snapshots } } })
      return
    }
    if (url.pathname.startsWith('/api/')) { state.unexpected.push(url.pathname); await route.abort(); return }
    await route.continue()
  })
  return state
}
for (const mobile of [false, true]) test(`forecast history shows compatible monthly results and legacy labels on ${mobile ? 'mobile' : 'desktop'} without writes`, async ({ page, context, baseURL }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 })
  const state = await mock(context, baseURL!)
  await page.goto('/forecast/history')
  const table = page.getByRole('table', { name: 'Monthly forecast results' })
  await expect(table.getByText('+$25.50', { exact: true })).toBeVisible(); await expect(table.getByText('125.5%', { exact: true })).toBeVisible()
  await expect(page.getByText('Month in progress', { exact: true })).toBeVisible()
  const legacy = table.getByRole('row').filter({ hasText: 'Unverified commitment' })
  const legacyCells = legacy.getByRole('cell')
  for (const index of [0, 2, 3]) await expect(legacyCells.nth(index)).toContainText('—')
  const incompatible = table.getByRole('row').filter({ hasText: 'Different reporting basis' })
  const incompatibleCells = incompatible.getByRole('cell')
  for (const index of [0, 2, 3]) await expect(incompatibleCells.nth(index)).toContainText('—')
  const zero = table.getByRole('row').filter({ hasText: 'Aug 2026' })
  await expect(zero.getByText('—', { exact: true })).toHaveCount(1)
  const snapshot = page.getByRole('table', { name: 'Business snapshot history' }).getByRole('row').filter({ hasText: 'Unverified legacy snapshot' })
  await expect(snapshot.getByText('—', { exact: true })).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(state.reads).toBe(1); expect(state.unexpected).toEqual([])
  await page.screenshot({ path: `test-results/rehearsal/forecast-history-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true })
})
test('forecast history recovers a denied read only through an explicit reload', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!); state.failed = true
  await page.goto('/forecast/history')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load forecast history' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Reload history' })).toHaveAttribute('href', '/forecast')
  expect(state.reads).toBe(1)
  state.failed = false; await page.reload()
  await expect(page.getByRole('table', { name: 'Monthly forecast results' })).toBeVisible()
  expect(state.reads).toBe(2); expect(state.unexpected).toEqual([])
})
test('forecast history distinguishes held loading and empty snapshot history without writes', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!); state.hold = true; state.empty = true
  try {
    await page.goto('/forecast/history')
    await expect.poll(() => state.started).toBe(true)
    await expect(page.getByRole('status').filter({ hasText: 'Loading forecast history' })).toBeVisible()
  } finally { state.release() }
  await expect(page.getByText('No business snapshots yet.', { exact: true })).toBeVisible()
  expect(state.reads).toBe(1); expect(state.unexpected).toEqual([])
})
