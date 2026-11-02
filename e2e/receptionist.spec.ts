import { test, expect } from '@playwright/test'

test('receptionist settings load from the authenticated workspace', async ({ page }) => {
  await page.goto('/settings')
  const loaded = page.waitForResponse((response) => response.url().endsWith('/api/admin/receptionist') && response.request().method() === 'GET')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  const response = await loaded
  expect(response.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'AI receptionist', exact: true })).toBeVisible()
  await expect(page.getByLabel('Business name', { exact: true })).not.toHaveValue('')
  await expect(page.getByLabel('Incoming call webhook URL')).toHaveValue(/\/api\/voice\/receptionist\/[\da-f-]+$/)
  await expect(page.getByRole('button', { name: 'Save receptionist settings' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('public voice webhook requires Twilio verification and admin settings require login', async ({ playwright, baseURL }) => {
  const external = await playwright.request.newContext({ baseURL })
  try {
    const voice = await external.post('/api/voice/receptionist/11111111-1111-4111-8111-111111111111', { form: { CallSid: `CA${'a'.repeat(32)}`, Direction: 'inbound' } })
    expect(voice.status()).toBe(403)
    expect(voice.headers()['content-type']).toContain('text/xml')
    expect(await voice.text()).toContain('<Reject/>')
    expect((await external.get('/api/admin/receptionist')).status()).toBe(401)
  } finally { await external.dispose() }
})
