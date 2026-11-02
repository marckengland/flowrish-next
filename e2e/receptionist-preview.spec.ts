import { expect, test } from '@playwright/test'
import { initialCallState } from '../src/lib/receptionist'

const ownerId = '11111111-1111-4111-8111-111111111111'
const stageId = '22222222-2222-4222-8222-222222222222'
const version = '2026-11-02T01:00:00.000Z'
const savedConfig = { enabled: false, businessName: 'Synthetic Bicycle Repairs', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: ownerId, stageId }
const settings = (config: typeof savedConfig | null) => ({ config, businessName: 'Synthetic Workspace', currentUserId: ownerId, members: [{ id: ownerId, name: 'Preview owner' }], stages: [{ id: stageId, name: 'New', pipeline: { name: 'Sales' } }], calls: [], webhookPath: '/api/voice/receptionist/33333333-3333-4333-8333-333333333333' })
const ready = { saved: true, settingsVersion: version, approvedDocuments: 0, hasManualKnowledge: false, voiceConfigured: false, hasAuthToken: false }

test('onboards the entered business and confirms a preview without enabling reception or writing CRM records', async ({ page }) => {
  page.setDefaultTimeout(10000)
  let config: typeof savedConfig | null = null
  const saves: unknown[] = [], previewInputs: Array<Record<string, unknown>> = []
  const state = { ...initialCallState(''), fullName: 'Preview Caller', phone: '+12025550123', reason: 'A synthetic repair enquiry' }
  await page.route('**/api/admin/receptionist**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/readiness')) return route.fulfill({ json: { data: ready } })
    if (path.endsWith('/preview')) {
      const input = request.postDataJSON()
      previewInputs.push(input)
      expect(Object.keys(input).every(key => ['state', 'settingsVersion', 'speech', 'digits'].includes(key))).toBe(true)
      if (!input.state) return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: version, reply: 'Thank you for calling Synthetic Bicycle Repairs. I am an AI receptionist. How can we help?', finished: false, callback: null, sources: [] } } })
      if (input.digits === '1') return route.fulfill({ json: { data: { state: { ...state, turns: 2 }, settingsVersion: version, reply: 'Preview complete. Nothing was saved.', finished: true, callback: { fullName: state.fullName, phone: state.phone, reason: state.reason }, sources: [] } } })
      return route.fulfill({ json: { data: { state: { ...state, turns: 1, awaitingConfirmation: true }, settingsVersion: version, reply: 'I have your callback details. Is that correct? Say yes or press 1 to confirm this preview callback summary.', finished: false, callback: null, sources: [] } } })
    }
    if (request.method() === 'GET') return route.fulfill({ json: settings(config) })
    expect(request.method()).toBe('PUT')
    config = request.postDataJSON()
    saves.push(config)
    expect(config?.enabled).toBe(false)
    return route.fulfill({ json: { config } })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Receptionist setup steps' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Business name', exact: true }).fill('Synthetic Bicycle Repairs')
  await expect(page.locator('[aria-label="Greeting preview"]')).toContainText('Thank you for calling Synthetic Bicycle Repairs')
  await expect(page.getByRole('button', { name: 'Start browser preview', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: 'When to answer', exact: true }).selectOption('always')
  await page.getByRole('button', { name: 'Save receptionist settings', exact: true }).click()
  await expect(page.getByText('Receptionist settings saved.', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Enable AI receptionist', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: 'Check saved setup', exact: true }).click()
  await expect(page.getByText(/0 approved public documents/)).toBeVisible()
  await expect(page.getByText(/Phone credentials are missing/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Read replies aloud', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Preview conversation' })).toContainText('Synthetic Bicycle Repairs')
  await page.getByRole('textbox', { name: 'Caller message', exact: true }).fill('I am Preview Caller. Please call +12025550123 about a repair.')
  await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
  await page.getByRole('button', { name: 'Press 1 to confirm', exact: true }).click()
  await expect(page.getByText('Preview-only callback summary', { exact: true })).toBeVisible()
  await expect(page.getByText('Nothing was saved to your CRM. No callback was scheduled.', { exact: true })).toBeVisible()
  await expect(page.getByText('Conversation tested in browser. Phone routing has not been verified.', { exact: true })).toBeVisible()
  expect(saves).toHaveLength(1)
  expect(previewInputs).toHaveLength(3)
  expect(previewInputs[0]).toEqual({})
  expect(previewInputs[2].digits).toBe('1')
  await page.screenshot({ path: '/tmp/flowrish-receptionist-preview-result.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Reset preview', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Preview conversation' })).toHaveCount(0)
})

test('keeps text preview usable without speech synthesis and resets on a stale configuration', async ({ page }) => {
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }) })
  await page.route('**/api/admin/receptionist**', async route => {
    if (!new URL(route.request().url()).pathname.endsWith('/preview')) return route.fulfill({ json: settings(savedConfig) })
    const input = route.request().postDataJSON()
    if (input.state) return route.fulfill({ status: 409, json: { error: { code: 'PREVIEW_STALE', message: 'Saved settings changed. Start a new preview.' } } })
    return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: version, reply: 'Thank you for calling Synthetic Bicycle Repairs.', finished: false, callback: null, sources: [] } } })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Read replies aloud', exact: true })).toBeDisabled()
  await expect(page.getByText('Read-aloud is unavailable in this browser. You can still test the full conversation with text.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
  await page.getByRole('textbox', { name: 'Caller message', exact: true }).fill('Hello')
  await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Saved settings changed' })).toContainText('Saved settings changed')
  await expect(page.getByRole('log', { name: 'Preview conversation' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start browser preview', exact: true })).toBeEnabled()
})

test('live readiness returns only safe fields and missing configuration cannot start a preview', async ({ request, page }) => {
  const response = await request.get('/api/admin/receptionist/readiness')
  expect(response.status()).toBe(200)
  const data = (await response.json()).data
  expect(Object.keys(data).sort()).toEqual(['approvedDocuments', 'hasAuthToken', 'hasManualKnowledge', 'saved', 'settingsVersion', 'voiceConfigured'])
  if (!data.saved) {
    const preview = await request.post('/api/admin/receptionist/preview', { data: {} })
    expect(preview.status()).toBe(409)
    expect((await preview.json()).error.message).toMatch(/save/i)
  }
  const after = await request.get('/api/admin/receptionist/readiness')
  expect((await after.json()).data).toEqual(data)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Receptionist setup steps' })).toBeVisible()
  await page.getByText('Set up your receptionist', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/flowrish-receptionist-setup.png', fullPage: true })
})

test('preview and readiness require authentication', async ({ playwright, baseURL }) => {
  const external = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    expect((await external.get('/api/admin/receptionist/readiness')).status()).toBe(401)
    expect((await external.post('/api/admin/receptionist/preview', { data: {} })).status()).toBe(401)
  } finally { await external.dispose() }
})
