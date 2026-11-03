import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { renderWebsiteReceptionistHtml } from '../src/lib/website-receptionist-html'

const shop = 'https://callback-shop.example', app = 'https://callback-widget.example', id = '11111111-1111-4111-8111-111111111111'
const calendar = { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z' }
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10)
async function setup(page: Page, retry = false, errorCode?: string, legacyEmbed = false) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []
  let attempts = 0
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === shop) return route.fulfill({ contentType: 'text/html', body: `<script src="${app}/receptionist-widget.js" data-flowrish-receptionist="${id}"></script>` })
    if (url.origin === app && ['/receptionist-widget.js', '/receptionist-widget-frame.js'].includes(url.pathname)) return route.fulfill({ contentType: 'application/javascript', body: await readFile(`${process.cwd()}/public${url.pathname}`, 'utf8') })
    if (url.origin === app && url.pathname.endsWith('/embed')) return route.fulfill({ contentType: 'text/html', body: renderWebsiteReceptionistHtml({ publicId: id, businessName: 'Sample Business', siteOrigin: shop, allowedOrigins: [shop] }, '0123456789abcdef0123456789abcdef').replace(legacyEmbed ? /<div id="preferred-section"[\s\S]*?<\/div>/ : /(?!) /, '').replace(legacyEmbed ? '<dt>Preferred callback time</dt><dd id="review-time"></dd>' : '__unused__', '') })
    if (url.origin !== app || route.request().method() !== 'POST') throw Error('Unexpected external request')
    const path = url.pathname.split('/').at(-1)!, body = route.request().postDataJSON(); requests.push({ path, body })
    if (path === 'session') return route.fulfill({ json: { data: { token: 'a'.repeat(64), businessName: 'Sample Business', greeting: 'Hello', turn: 0, expiresAt: new Date(Date.now() + 1800000).toISOString(), callbackHours: calendar } } })
    if (path !== 'callback') throw Error('AI requests are forbidden in callback scheduling tests')
    if (errorCode) return route.fulfill({ status: errorCode === 'CALLBACK_TIME_CHANGED' ? 409 : 400, json: { error: { code: errorCode, message: 'Private SQL diagnostic' } } })
    if (retry && ++attempts === 1) return route.abort('failed')
    await route.fulfill({ json: { data: { received: true } } })
  })
  await page.goto(shop); await page.getByRole('button', { name: 'Chat with us', exact: true }).click()
  const frame = page.frameLocator('iframe[title="Business website assistant"]')
  await frame.getByRole('textbox', { name: 'Full name', exact: true }).fill('Sample Visitor')
  await frame.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+12025550123')
  await frame.getByRole('textbox', { name: 'What should the business know?', exact: true }).fill('Ask about services')
  return { frame, requests }
}

for (const mobile of [false, true]) test(`includes preferred business-local time in fresh callback consent on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  const { frame, requests } = await setup(page)
  const time = frame.getByLabel('Preferred callback time (optional)', { exact: true })
  await expect(time).toBeVisible(); await expect(frame.getByText(/Business time zone: Asia\/Manila/)).toBeVisible()
  await time.fill(`${date}T17:00`); await frame.getByRole('button', { name: 'Review callback request', exact: true }).click()
  await expect(frame.locator('#callback-status')).toContainText('business hours')
  await time.fill(`${date}T10:00`); await frame.getByRole('button', { name: 'Review callback request', exact: true }).click()
  await expect(frame.locator('#review-time')).toContainText(`${date} 10:00 (Asia/Manila)`)
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check()
  await time.fill(`${date}T11:00`); await expect(frame.locator('#callback-review')).toBeHidden()
  await frame.getByRole('button', { name: 'Review callback request', exact: true }).click(); await expect(frame.getByRole('checkbox')).not.toBeChecked()
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click()
  await expect(frame.locator('#callback-status')).toContainText('sent to the business for review')
  expect(requests.map(request => request.path)).toEqual(['session', 'callback'])
  expect(requests[1].body.preferredTime).toEqual({ localTime: `${date}T11:00`, timeZone: calendar.timeZone, businessVersion: calendar.version })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('retries an uncertain timed request with the exact original readback', async ({ page }) => {
  const { frame, requests } = await setup(page, true)
  const time = frame.getByLabel('Preferred callback time (optional)', { exact: true })
  await time.fill(`${date}T10:00`); await frame.getByRole('button', { name: 'Review callback request', exact: true }).click()
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click()
  await expect(frame.locator('#callback-status')).toContainText('We could not confirm the response'); await expect(time).toBeDisabled()
  await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click(); await expect(frame.locator('#callback-status')).toContainText('sent to the business for review')
  expect(requests[1].body).toEqual(requests[2].body)
})

test('requires fresh review after a server time rejection without exposing diagnostics', async ({ page }) => {
  const { frame, requests } = await setup(page, false, 'CALLBACK_TIME_INVALID')
  await frame.getByLabel('Preferred callback time (optional)', { exact: true }).fill(`${date}T10:00`)
  await frame.getByRole('button', { name: 'Review callback request', exact: true }).click()
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click()
  await expect(frame.locator('#callback-status')).toContainText('future callback time')
  await expect(frame.locator('#callback-review')).toBeHidden(); await expect(frame.getByText('Private SQL diagnostic')).toHaveCount(0)
  expect(requests.map(request => request.path)).toEqual(['session', 'callback'])
})

test('stale business hours require an explicit new chat without silently resending timing', async ({ page }) => {
  const { frame, requests } = await setup(page, false, 'CALLBACK_TIME_CHANGED')
  await frame.getByLabel('Preferred callback time (optional)', { exact: true }).fill(`${date}T10:00`)
  await frame.getByRole('button', { name: 'Review callback request', exact: true }).click()
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click()
  await expect(frame.locator('#callback-status')).toContainText('Start a new chat')
  await expect(frame.getByRole('button', { name: 'Start a new chat', exact: true })).toBeVisible()
  await expect(frame.getByRole('button', { name: 'Review callback request', exact: true })).toBeDisabled()
  expect(requests.map(request => request.path)).toEqual(['session', 'callback'])
})

test('new widget script preserves untimed callbacks in an older cached embed', async ({ page }) => {
  const { frame, requests } = await setup(page, false, undefined, true)
  await expect(frame.getByLabel('Preferred callback time (optional)', { exact: true })).toHaveCount(0)
  await frame.getByRole('button', { name: 'Review callback request', exact: true }).click()
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click()
  await expect(frame.locator('#callback-status')).toContainText('sent to the business for review')
  expect(requests.map(request => request.path)).toEqual(['session', 'callback']); expect(requests[1].body.preferredTime).toBeUndefined()
})
