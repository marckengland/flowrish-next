import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
const id = '11111111-1111-4111-8111-111111111111'
const chart = { type: 'bar', title: 'Provided pipeline', unit: 'deals', data: [{ label: 'Qualified', value: 12 }, { label: 'Won', value: 4 }] }
const reply = 'Qualified leads are the largest group. Follow up with them first.\n\n| Stage | Deals |\n| --- | ---: |\n| Qualified | 12 |\n| Won | 4 |\n\n```chart\n' + JSON.stringify(chart) + '\n```'
const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
async function mock(context: BrowserContext, baseURL: string, content = reply, options: { history?: boolean; interrupted?: boolean; action?: boolean } = {}) {
  const origin = new URL(baseURL).origin
  const state = { chats: 0, writes: [] as string[], unexpected: [] as string[] }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method()
    const deny = async () => { state.unexpected.push(`${method} ${path}`); await route.abort() }
    if (url.origin !== origin || /receptionist-widget/.test(path)) { await deny(); return }
    if (path.startsWith('/api/')) {
      if ((path === '/api/conversations/latest' || path === `/api/conversations/${id}`) && method === 'GET') { await route.fulfill({ json: { data: options.history ? { id, title: 'Synthetic review', messages: [{ id: 'answer', role: 'assistant', content }] } : null } }); return }
      if (path === '/api/ai/chat' && method === 'POST') {
        state.chats++; expect(request.postDataJSON().message).toContain('provided')
        const action = options.action ? { type: 'create_task', description: 'Propose a review task', params: { title: 'Review supplied figures' } } : null
        const body = frame({ type: 'delta', text: content }) + (options.interrupted ? frame({ type: 'error', message: 'Synthetic connection interrupted.' }) : frame({ type: 'done', conversationId: id, message: content, action }))
        await route.fulfill({ contentType: 'text/event-stream', body }); return
      }
      if (!['GET', 'HEAD'].includes(method)) state.writes.push(path)
      await deny(); return
    }
    if (!['GET', 'HEAD'].includes(method)) { await deny(); return }
    await route.continue()
  })
  return state
}
async function open(page: Page) {
  await page.goto('/ai-quality'); await page.getByRole('button', { name: 'Open Airish', exact: true }).click()
  await expect(page.getByText('Loading your conversation…')).toHaveCount(0)
  return page.getByRole('complementary', { name: 'Airish assistant' })
}
async function ask(page: Page) {
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Compare the provided figures.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop generating', exact: true })).toHaveCount(0)
}
for (const mobile of [false, true]) test(`airish quality presents useful tables and charts on ${mobile ? 'mobile' : 'desktop'}`, async ({ page, context, baseURL }, info) => {
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 })
  const state = await mock(context, baseURL!); const panel = await open(page); await ask(page)
  await expect(panel.getByRole('img', { name: 'Provided pipeline', exact: true })).toBeVisible()
  await expect(panel.getByRole('table')).toHaveCount(2)
  await expect(panel.getByText('Qualified leads are the largest group. Follow up with them first.', { exact: true })).toBeVisible()
  const region = panel.getByRole('region', { name: 'Provided pipeline data', exact: true }); await region.focus(); await expect(region).toBeFocused()
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('airish-answer.png') })
  expect(state.chats).toBe(1); expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('airish quality restores a saved visual answer without an AI request', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!, reply, { history: true }); const panel = await open(page)
  await expect(panel.getByRole('img', { name: 'Provided pipeline', exact: true })).toBeVisible(); await page.reload()
  await page.getByRole('button', { name: 'Open Airish', exact: true }).click()
  await expect(panel.getByRole('table', { name: 'Provided pipeline data', exact: true })).toBeVisible()
  expect(state.chats).toBe(0); expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('airish quality keeps interrupted chart output honest without retrying', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!, 'The supplied answer was interrupted.\n\n```chart\n{"type":"bar"', { interrupted: true }); const panel = await open(page); await ask(page)
  await expect(panel.getByText(/Chart unavailable/)).toBeVisible(); await expect(panel.getByText('Preparing chart…')).toHaveCount(0)
  await expect(panel.getByRole('alert')).toContainText('Synthetic connection interrupted.')
  expect(state.chats).toBe(1); expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('airish quality rejects executable and invalid chart content', async ({ page, context, baseURL }) => {
  const content = '| Stage | Deals |\n| --- | --- |\n| <img src=x onerror=alert(1)> | 12 |\n\n```chart\n{"type":"html","title":"Bad","data":[]}\n```'
  const state = await mock(context, baseURL!, content); const panel = await open(page); await ask(page)
  await expect(panel.getByRole('cell', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible()
  await expect(panel.getByText(/Chart unavailable/)).toBeVisible(); await expect(panel.locator('svg[role="img"], img, script, iframe')).toHaveCount(0)
  expect(state.chats).toBe(1); expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
test('airish quality keeps visual answers separate from explicit action review', async ({ page, context, baseURL }) => {
  const state = await mock(context, baseURL!, reply, { action: true }); const panel = await open(page); await ask(page)
  await expect(panel.getByRole('img', { name: 'Provided pipeline', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(panel.getByText('Action cancelled.', { exact: true })).toBeVisible()
  expect(state.chats).toBe(1); expect(state.writes).toEqual([]); expect(state.unexpected).toEqual([])
})
