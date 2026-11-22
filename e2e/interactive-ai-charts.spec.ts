import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const id = '11111111-1111-4111-8111-111111111111'
const chart = {
  type: 'bar', title: 'Supplied pipeline', unit: 'deals',
  data: [
    { label: 'Qualified', value: 2, details: { columns: ['Name', 'Next step'], rows: [['Maya Demo', 'Review outline'], ['Luis Example', '<img src=x onerror=alert(1)>']] } },
    { label: 'Won', value: 1 },
  ],
}
const reply = (value: unknown) => 'Here are the supplied figures.\n\n```chart\n' + JSON.stringify(value) + '\n```'
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

async function mock(context: BrowserContext, baseURL: string, answers = [reply(chart)], options: { history?: boolean; action?: boolean } = {}) {
  const state = { chats: 0, reads: 0, unexpected: [] as string[] }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const deny = async () => { state.unexpected.push(`${method} ${path}`); await route.abort() }
    if (url.origin !== new URL(baseURL).origin || /receptionist-widget/.test(path)) { await deny(); return }
    if ((path === '/api/conversations/latest' || path === `/api/conversations/${id}`) && method === 'GET') {
      state.reads++
      await route.fulfill({ json: { data: options.history ? { id, title: 'Supplied chart review', messages: [{ id: 'answer', role: 'assistant', content: answers[0] }] } : null } })
      return
    }
    if (path === '/api/ai/chat' && method === 'POST') {
      const message = answers[state.chats++]; expect(message).toBeDefined()
      const action = options.action ? { type: 'create_task', description: 'Review the supplied figures', params: { title: 'Review chart' } } : null
      await route.fulfill({ contentType: 'text/event-stream', body: frame({ type: 'delta', text: message }) + frame({ type: 'done', conversationId: id, message, action }) })
      return
    }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(method)) { await deny(); return }
    await route.continue()
  })
  return state
}

async function open(page: Page) {
  await page.goto('/ai-quality')
  await page.getByRole('button', { name: 'Open Airish', exact: true }).click()
  await expect(page.getByText('Loading your conversation…')).toHaveCount(0)
  return page.getByRole('complementary', { name: 'Airish assistant' })
}
async function ask(page: Page) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Compare the supplied test figures.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0)
}
async function layout(page: Page) {
  expect(await page.getByRole('complementary', { name: 'Airish assistant' }).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

for (const width of [1280, 390]) {
  test(`airish interactive bar filters and drills into supplied rows at ${width}px`, async ({ page, context, baseURL }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const state = await mock(context, baseURL!), panel = await open(page); await ask(page)
    const table = panel.getByRole('table', { name: 'Supplied pipeline data', exact: true })
    await expect(table.getByRole('row')).toHaveCount(3)
    await panel.getByRole('button', { name: 'Filter to Qualified, 2 deals, point 1 of 2', exact: true }).click()
    await expect(table.getByRole('row')).toHaveCount(2)
    await expect(table.getByRole('cell', { name: 'Won', exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: 'View details for Qualified', exact: true }).click()
    const details = panel.getByRole('table', { name: 'Qualified supplied rows', exact: true })
    await expect(details.getByRole('cell', { name: 'Maya Demo', exact: true })).toBeVisible()
    await expect(details.getByRole('cell', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible()
    await expect(panel.locator('img, script, iframe, a')).toHaveCount(0)
    await layout(page); await page.screenshot({ path: info.outputPath('supplied-details.png') })
    await panel.getByRole('button', { name: 'Show all', exact: true }).click()
    await expect(table.getByRole('row')).toHaveCount(3)
    await expect(panel.getByRole('table', { name: 'Qualified supplied rows', exact: true })).toHaveCount(0)
    expect(state.chats).toBe(1); expect(state.unexpected).toEqual([])
  })

  test(`airish interactive line supports keyboard selection for zero signed and duplicate labels at ${width}px`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 })
    const state = await mock(context, baseURL!, [reply({ type: 'line', title: 'Supplied changes', data: [{ label: 'Same', value: 0 }, { label: 'Same', value: -2.5 }] })])
    const panel = await open(page); await ask(page)
    const first = panel.getByRole('button', { name: 'Filter to Same, 0, point 1 of 2', exact: true })
    const second = panel.getByRole('button', { name: 'Filter to Same, -2.5, point 2 of 2', exact: true })
    const table = panel.getByRole('table', { name: 'Supplied changes data', exact: true })
    await first.focus(); await first.press('Space'); await expect(first).toHaveAttribute('aria-pressed', 'true')
    await expect(table.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('0')
    await first.press('Tab'); await expect(second).toBeFocused(); await second.press('Enter')
    await expect(second).toHaveAttribute('aria-pressed', 'true')
    await expect(table.getByRole('row').nth(1).getByRole('cell').nth(2)).toHaveText('-2.5')
    await second.press('Enter'); await expect(table.getByRole('row')).toHaveCount(3)
    await layout(page); expect(state.chats).toBe(1); expect(state.unexpected).toEqual([])
  })
}

test('airish interactive totals-only charts do not invent underlying records or links', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!, [reply({ ...chart, data: [{ label: 'New', value: 12 }] })])
  const panel = await open(page); await ask(page)
  await panel.getByRole('button', { name: 'New', exact: true }).click()
  await expect(panel.getByText('No underlying rows were supplied for New. Only the plotted value is available.', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: /View details/ })).toHaveCount(0)
  await expect(panel.getByRole('link')).toHaveCount(0)
  expect(state.chats).toBe(1); expect(state.unexpected).toEqual([])
})

test('airish interactive saved answers restore without generation requests and reset only local selection', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!, [reply(chart)], { history: true })
  let panel = await open(page)
  await panel.getByRole('button', { name: 'Qualified', exact: true }).click()
  await panel.getByRole('button', { name: 'View details for Qualified', exact: true }).click()
  await expect(panel.getByRole('cell', { name: 'Maya Demo', exact: true })).toBeVisible()
  panel = await open(page)
  await expect(panel.getByRole('table', { name: 'Supplied pipeline data', exact: true }).getByRole('row')).toHaveCount(3)
  await expect(panel.getByRole('button', { name: /View details/ })).toHaveCount(0)
  expect(state.chats).toBe(0); expect(state.reads).toBeGreaterThanOrEqual(2); expect(state.unexpected).toEqual([])
})

test('airish interactive incomplete and unsupported detail payloads stay inert until a valid answer is supplied', async ({ page, context, baseURL }) => {
  const invalid = { ...chart, data: [{ label: 'Qualified', value: 2, details: { columns: ['Name'], rows: [['Maya Demo']], href: 'javascript:alert(1)' } }] }
  const state = await mock(context, baseURL!, ['```chart\n{"type":"bar"', reply(invalid), reply(chart)])
  const panel = await open(page); await ask(page)
  await expect(panel.getByText(/Chart unavailable/)).toBeVisible()
  await expect(panel.getByRole('button', { name: /Filter to/ })).toHaveCount(0)
  expect(state.chats).toBe(1)
  await ask(page); await expect(panel.getByText(/Chart unavailable/)).toHaveCount(2)
  await expect(panel.getByRole('button', { name: /Filter to/ })).toHaveCount(0)
  await expect(panel.locator('script, iframe, img')).toHaveCount(0)
  await ask(page); await expect(panel.getByRole('button', { name: 'Filter to Qualified, 2 deals, point 1 of 2', exact: true })).toBeVisible()
  expect(state.chats).toBe(3); expect(state.unexpected).toEqual([])
})

test('airish interactive clicks preserve an unsent chat draft and pending action review without automatic writes', async ({ page, context, baseURL }, info) => {
  const state = await mock(context, baseURL!, [reply(chart)], { action: true })
  const panel = await open(page); await ask(page)
  const message = panel.getByRole('textbox', { name: 'Message', exact: true })
  await message.fill('Unsent draft: keep these words and my pending review.')
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  const readsBeforeSelection = state.reads
  await panel.getByRole('button', { name: 'Qualified', exact: true }).click()
  await panel.getByRole('button', { name: 'View details for Qualified', exact: true }).click()
  await panel.getByRole('button', { name: 'Hide details for Qualified', exact: true }).click()
  await panel.getByRole('button', { name: 'Show all', exact: true }).click()
  await expect(message).toHaveValue('Unsent draft: keep these words and my pending review.')
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  await expect(panel.getByText('Action cancelled.', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('draft-and-review.png') })
  expect(state.reads).toBe(readsBeforeSelection)
  expect(state.chats).toBe(1); expect(state.unexpected).toEqual([])
})
