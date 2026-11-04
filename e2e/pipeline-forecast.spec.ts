import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { pipelineIds as ids, pipelineLeads } from './rehearsal-app/pipeline-fixtures'
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
async function mock(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin
  let release!: () => void
  const state = { stage: ids.new, empty: false, listDenied: false, forecastDenied: false, moveMode: 'ok', submitMode: 'ok', hold: false, started: false, commit: null as null | Record<string, string>, writes: [] as Array<{ path: string; body: Record<string, string> }>, unexpected: [] as string[], release: () => release?.() }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    if (url.origin !== origin || /receptionist-widget/.test(path)) { state.unexpected.push(path); await route.abort(); return }
    if (path === '/api/leads' && method === 'GET') {
      if (url.searchParams.get('pipelineId') !== ids.pipeline) { state.unexpected.push('Unscoped pipeline read'); await route.abort(); return }
      if (state.listDenied) { await route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN', message: 'Synthetic pipeline denied' } } }); return }
      const rows = state.empty ? [] : pipelineLeads(state.stage)
      await route.fulfill({ json: { data: rows, pagination: { page: 1, pageSize: 200, total: rows.length, totalPages: 1 } } }); return
    }
    if (path === `/api/leads/${ids.lead}/move` && method === 'PATCH') {
      const body = request.postDataJSON(); state.writes.push({ path, body }); state.started = true
      if (state.hold) await new Promise<void>(resolve => { release = resolve })
      if (state.moveMode === 'rejected') { await route.fulfill({ status: 503, json: { error: { message: 'Synthetic move unavailable' } } }); return }
      state.stage = body.toStageId
      if (state.moveMode === 'uncertain') { await route.abort('failed'); return }
      await route.fulfill({ json: { data: { id: ids.lead, stageId: state.stage } } }); return
    }
    if ((path === '/api/forecast' || path === '/api/forecast/compare') && method === 'GET') {
      if (state.forecastDenied) { await route.fulfill({ status: 403, json: { error: { message: 'Synthetic forecast denied' } } }); return }
      // Hand-calculated reference values: one USD 1,000 open deal, a USD 300
      // existing win, a USD 200 loss, and PHP 10,000 excluded from money totals.
      const metrics = state.empty ? { totalPipeline: 0, weightedPipeline: 0, aiPredicted: 0, winRate: 0 } : state.stage === ids.qualified ? { totalPipeline: 1000, weightedPipeline: 500, aiPredicted: 440, winRate: 50 } : state.stage === ids.won ? { totalPipeline: 0, weightedPipeline: 0, aiPredicted: 390, winRate: 66.6667 } : state.stage === ids.lost ? { totalPipeline: 0, weightedPipeline: 0, aiPredicted: 90, winRate: 33.3333 } : { totalPipeline: 1000, weightedPipeline: 250, aiPredicted: 265, winRate: 50 }
      await route.fulfill({ json: { data: path === '/api/forecast' ? metrics : { latestSubmission: state.commit, riskLevel: state.commit ? 'On Track' : null, aiPredicted: metrics.aiPredicted } } }); return
    }
    if (path === '/api/mock/forecast' && method === 'POST') {
      const body = request.postDataJSON(); state.writes.push({ path, body })
      if (state.submitMode === 'rejected') { await route.fulfill({ json: { error: 'Synthetic forecast rejected' } }); return }
      state.commit = { ...body, id: 'synthetic-commit' }
      if (state.submitMode === 'uncertain') { await route.abort('failed'); return }
      await route.fulfill({ json: { data: { id: 'synthetic-commit' } } }); return
    }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { state.unexpected.push(`${method} ${path}`); await route.abort(); return }
    await route.continue()
  })
  return state
}
const column = (page: Page, id: string) => page.locator(`[data-stage-id="${id}"]`)
const card = (page: Page) => page.locator(`[data-lead-id="${ids.lead}"]`)
async function metric(page: Page, label: string, value: string) {
  const panel = page.getByRole('region', { name: 'Pipeline metrics' })
  await expect(panel.getByText(label, { exact: true }).locator('../..')).toContainText(value)
}
for (const mobile of [false, true]) test(`pipeline audit moves, closes, reopens and forecasts on ${mobile ? 'mobile' : 'desktop'} with mocks only`, async ({ context, page, baseURL }) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1365, height: 900 })
  const state = await mock(context, baseURL!)
  await page.goto('/pipeline')
  await expect(card(page).getByRole('combobox')).toBeEnabled()
  await expect(column(page, ids.new).getByLabel('Stage total value')).toHaveAttribute('title', /10,000.*1,000/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/rehearsal/pipeline-board-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true })
  if (mobile) await card(page).getByRole('combobox').selectOption(ids.qualified)
  else await card(page).dragTo(column(page, ids.qualified), { sourcePosition: { x: 5, y: 50 }, targetPosition: { x: 20, y: 80 } })
  await expect(column(page, ids.qualified).locator(`[data-lead-id="${ids.lead}"]`)).toBeVisible()
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await metric(page, 'Total pipeline', '$1,000'); await metric(page, 'Weighted pipeline', '$500'); await metric(page, 'AI predicted', '$440')
  await expect(page.getByText(/Money values use USD only/)).toBeVisible()
  await page.getByRole('link', { name: 'Pipeline', exact: true }).click()
  await expect(card(page).getByRole('combobox')).toBeEnabled(); await card(page).getByRole('combobox').selectOption(ids.won)
  await expect(column(page, ids.won).locator(`[data-lead-id="${ids.lead}"]`)).toBeVisible()
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await metric(page, 'Total pipeline', '$0'); await metric(page, 'AI predicted', '$390'); await metric(page, 'Win rate (90d)', '66.7%')
  await page.getByRole('link', { name: 'Pipeline', exact: true }).click()
  await expect(card(page).getByRole('combobox')).toBeEnabled(); await card(page).getByRole('combobox').selectOption(ids.new)
  await expect(column(page, ids.new).locator(`[data-lead-id="${ids.lead}"]`)).toBeVisible()
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await metric(page, 'AI predicted', '$265')
  await page.getByLabel(/Commit amount/).fill('300'); await page.getByLabel('Notes', { exact: true }).fill('Synthetic reviewed commit')
  await page.getByRole('button', { name: 'Submit forecast', exact: true }).click()
  await expect(page.getByText('Forecast submitted.', { exact: true })).toBeVisible()
  expect(state.writes.map(row => row.path)).toEqual([`/api/leads/${ids.lead}/move`, `/api/leads/${ids.lead}/move`, `/api/leads/${ids.lead}/move`, '/api/mock/forecast'])
  expect(state.commit).toMatchObject({ period: '2026-11', commitAmount: '300' })
  expect(state.unexpected).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/rehearsal/pipeline-forecast-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true })
})
test('pipeline audit reconciles rejected and uncertain moves without repeating writes', async ({ context, page, baseURL }) => {
  const state = await mock(context, baseURL!); state.moveMode = 'rejected'
  await page.goto('/pipeline'); await expect(card(page).getByRole('combobox')).toBeEnabled()
  await card(page).getByRole('combobox').selectOption(ids.lost)
  await expect(page.getByText('Synthetic move unavailable', { exact: true })).toBeVisible()
  await expect(column(page, ids.new).locator(`[data-lead-id="${ids.lead}"]`)).toBeVisible()
  await expect(card(page).getByRole('combobox')).toBeEnabled()
  expect(state.writes).toHaveLength(1)
  state.moveMode = 'uncertain'; await card(page).getByRole('combobox').selectOption(ids.lost)
  await expect(column(page, ids.lost).locator(`[data-lead-id="${ids.lead}"]`)).toBeVisible()
  await expect(card(page).getByRole('combobox')).toBeEnabled()
  expect(state.writes).toHaveLength(2); expect(state.unexpected).toEqual([])
})
test('pipeline audit holds overlapping moves until the confirmed save and refresh finish', async ({ context, page, baseURL }) => {
  const state = await mock(context, baseURL!); state.hold = true
  await page.goto('/pipeline'); await expect(card(page).getByRole('combobox')).toBeEnabled()
  try {
    await card(page).getByRole('combobox').selectOption(ids.won)
    await expect.poll(() => state.started).toBe(true)
    await expect(card(page).getByRole('combobox')).toBeDisabled()
    await expect(card(page)).not.toHaveAttribute('draggable', 'true')
    expect(state.writes).toHaveLength(1)
  } finally { state.release() }
  await expect(column(page, ids.won).locator(`[data-lead-id="${ids.lead}"]`)).toBeVisible()
  await expect(card(page).getByRole('combobox')).toBeEnabled()
  expect(state.writes).toHaveLength(1); expect(state.unexpected).toEqual([])
})
test('pipeline audit handles empty and read-only boards and forecasts without writes', async ({ context, page, baseURL }) => {
  const state = await mock(context, baseURL!); state.empty = true
  await page.goto('/pipeline?empty=1'); await expect(page.getByText('No leads', { exact: true })).toHaveCount(4)
  state.empty = false
  await page.goto('/pipeline?readonly=1'); await expect(page.getByRole('link', { name: 'Practice Prospect', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await page.getByRole('link', { name: 'Forecast', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Submit forecast', exact: true })).toBeDisabled()
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('pipeline audit clears private cards when the refresh is denied', async ({ context, page, baseURL }) => {
  const state = await mock(context, baseURL!); state.listDenied = true
  await page.goto('/pipeline')
  await expect(page.getByText(/Couldn.t refresh pipeline/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Practice Prospect', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Refresh pipeline' })).toBeVisible()
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('pipeline audit preserves rejected forecast drafts and resolves a lost response by reading', async ({ context, page, baseURL }) => {
  const state = await mock(context, baseURL!); state.submitMode = 'rejected'
  await page.goto('/forecast'); await page.getByLabel(/Commit amount/).fill('300'); await page.getByLabel('Notes', { exact: true }).fill('Keep my draft')
  await page.getByRole('button', { name: 'Submit forecast', exact: true }).click()
  await expect(page.getByText('Synthetic forecast rejected', { exact: true })).toBeVisible()
  await expect(page.getByLabel(/Commit amount/)).toHaveValue('300'); await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Keep my draft')
  expect(state.writes).toHaveLength(1)
  state.submitMode = 'uncertain'; await page.getByRole('button', { name: 'Submit forecast', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Reload saved forecast' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit forecast', exact: true })).toBeDisabled()
  await page.getByRole('link', { name: 'Reload saved forecast' }).click()
  await expect(page.getByLabel(/Commit amount/)).toHaveValue('300')
  expect(state.writes).toHaveLength(2); expect(state.unexpected).toEqual([])
})
test('pipeline audit hides denied financial reads without submitting anything', async ({ context, page, baseURL }) => {
  const state = await mock(context, baseURL!); state.forecastDenied = true
  await page.goto('/forecast'); await expect(page.getByText('Forecast is not available.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit forecast', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pipeline metrics' })).toHaveCount(0)
  expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
