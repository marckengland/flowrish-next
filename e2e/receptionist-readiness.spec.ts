import { expect, test } from '@playwright/test'
import { initialCallState } from '../src/lib/receptionist'

const ownerId = '11111111-1111-4111-8111-111111111111'
const stageId = '22222222-2222-4222-8222-222222222222'
const version = '2026-11-02T01:00:00.000Z'
const config = { enabled: false, businessName: 'Synthetic Bicycle Repairs', knowledge: 'Puncture repair costs 250 pesos.', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: ownerId, stageId }
const settings = { config, businessName: 'Synthetic Workspace', currentUserId: ownerId, members: [{ id: ownerId, name: 'Preview owner' }], stages: [{ id: stageId, name: 'New', pipeline: { name: 'Sales' } }], calls: [], webhookPath: '/api/voice/receptionist/33333333-3333-4333-8333-333333333333' }
const checklist = { scope: 'saved_setup', checkedAt: version, settingsVersion: version, checks: [
  { id: 'business', label: 'Business name', status: 'complete', detail: 'A business greeting name is saved.' },
  { id: 'hours', label: 'Business hours', status: 'complete', detail: 'Working hours and time zone are saved.' },
  { id: 'knowledge', label: 'Approved business knowledge', status: 'complete', detail: 'Saved FAQs available.' },
  { id: 'callbacks', label: 'Callback owner and stage', status: 'complete', detail: 'Owner and stage are configured.' },
  { id: 'ai', label: 'AI configuration and allowance', status: 'attention', detail: 'Organization AI is paused. Deployment credentials will not be used.' },
] }

test('checks saved setup explicitly and rehearses callback correction with mocked replies only', async ({ page }) => {
  let checks = 0
  const inputs: Array<{ speech?: string; state?: unknown }> = []
  const unexpected: string[] = []
  await page.route('**/api/admin/ai-provider**', route => { unexpected.push('AI provider endpoint'); return route.fulfill({ status: 503, json: { error: { message: 'Disabled in mocked verification' } } }) })
  await page.route('**/api/admin/receptionist**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/checklist')) { checks++; return route.fulfill({ json: { data: checklist } }) }
    if (path.endsWith('/preview')) {
      const input = route.request().postDataJSON()
      inputs.push(input)
      const corrected = inputs.length >= 4
      const state = { ...initialCallState(''), fullName: corrected ? 'Jordan Example' : 'Jamie Example', phone: corrected ? '+12025550124' : '+12025550123', reason: 'A service inquiry', awaitingConfirmation: inputs.length >= 3, turns: inputs.length - 1 }
      const finished = input.speech === 'yes'
      const reply = !input.state ? 'Thank you for calling Synthetic Bicycle Repairs.' : inputs.length === 2 ? 'A puncture repair costs 250 pesos.' : finished ? 'Preview complete. Nothing was saved.' : `Please confirm ${state.fullName}, ${state.phone}, about ${state.reason}.`
      return route.fulfill({ json: { data: { state, settingsVersion: version, reply, finished, callback: finished ? { fullName: state.fullName, phone: state.phone, reason: state.reason } : null, sources: [] } } })
    }
    if (path === '/api/admin/receptionist' && route.request().method() === 'GET') return route.fulfill({ json: settings })
    unexpected.push(path)
    return route.fulfill({ status: 503, json: { error: { message: 'Unexpected test request' } } })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await expect(page.getByText('Saved setup has not been checked.', { exact: true })).toBeVisible()
  expect(checks).toBe(0)
  expect(inputs).toHaveLength(0)
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click()
  await expect(page.getByText('4 of 5 saved setup checks complete', { exact: true })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Saved setup checks' })).toContainText('Organization AI is paused')
  expect(checks).toBe(1)
  expect(inputs).toHaveLength(0)
  await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Correct callback details', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Confirm callback', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Pricing and services', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Caller message' })).toHaveValue('What services do you offer, and what do they cost?')
  expect(inputs).toHaveLength(1)
  await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('250 pesos')
  await page.getByRole('button', { name: 'Request a callback', exact: true }).click()
  expect(inputs).toHaveLength(2)
  await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Correct callback details', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Correct callback details', exact: true }).click()
  expect(inputs).toHaveLength(3)
  await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('Jordan Example')
  await page.getByRole('button', { name: 'Confirm callback', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Caller message' })).toHaveValue('yes')
  expect(inputs).toHaveLength(4)
  await page.getByRole('button', { name: 'Send caller message', exact: true }).click()
  await expect(page.getByText('Preview-only callback summary', { exact: true })).toBeVisible()
  await expect(page.getByText('Nothing was saved to your CRM. No callback was scheduled.', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Enable AI receptionist', exact: true })).not.toBeChecked()
  expect(inputs).toHaveLength(5)
  expect(unexpected).toEqual([])
})

test('clears old checklist results on edits and renders scenarios at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let checks = 0
  await page.route('**/api/admin/receptionist**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/checklist')) { checks++; return route.fulfill({ json: { data: checklist } }) }
    if (path.endsWith('/preview')) return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: version, reply: 'Thank you for calling Synthetic Bicycle Repairs.', finished: false, callback: null, sources: [] } } })
    return route.fulfill({ json: settings })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click()
  await expect(page.getByText('4 of 5 saved setup checks complete', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Business name', exact: true }).fill('Unsaved business')
  await expect(page.getByRole('button', { name: 'Check readiness', exact: true })).toBeDisabled()
  await expect(page.getByRole('list', { name: 'Saved setup checks' })).toHaveCount(0)
  expect(checks).toBe(1)
  await page.getByRole('textbox', { name: 'Business name', exact: true }).fill(config.businessName)
  await expect(page.getByText('Saved setup has not been checked.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pricing and services', exact: true })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).not.toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByText('Try a scenario', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/flowrish-readiness-mobile.png', fullPage: true })
})
