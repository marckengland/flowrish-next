import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { renderWebsiteReceptionistHtml } from '../src/lib/website-receptionist-html'

const shop = 'https://calendar-shop.example', app = 'https://calendar-widget.example', id = '11111111-1111-4111-8111-111111111111'
const day = new Date(Date.now() + 7 * 86400000); while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
const date = day.toISOString().slice(0, 10), next = new Date(day.getTime() + 86400000).toISOString().slice(0, 10), saturday = new Date(day.getTime() + 5 * 86400000).toISOString().slice(0, 10)
for (const mobile of [false, true]) test(`widget respects closed, shorter and special weekend dates on ${mobile ? 'mobile' : 'desktop'} with mocked transport`, async ({ page }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  const calls: Array<{ path: string; body: Record<string, unknown> }> = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === shop) return route.fulfill({ contentType: 'text/html', body: `<script src="${app}/receptionist-widget.js" data-flowrish-receptionist="${id}"></script>` })
    if (url.origin === app && ['/receptionist-widget.js', '/receptionist-widget-frame.js'].includes(url.pathname)) return route.fulfill({ contentType: 'application/javascript', body: await readFile(`${process.cwd()}/public${url.pathname}`, 'utf8') })
    if (url.origin === app && url.pathname.endsWith('/embed')) return route.fulfill({ contentType: 'text/html', body: renderWebsiteReceptionistHtml({ publicId: id, businessName: 'Sample Business', siteOrigin: shop, allowedOrigins: [shop] }, '0123456789abcdef0123456789abcdef') })
    if (url.origin !== app || route.request().method() !== 'POST') throw Error('Unexpected external transport')
    const path = url.pathname.split('/').at(-1)!, body = route.request().postDataJSON(); calls.push({ path, body })
    if (path === 'session') return route.fulfill({ json: { data: { token: 'a'.repeat(64), greeting: 'Hello', turn: 0, expiresAt: new Date(Date.now() + 1800000).toISOString(), callbackHours: { timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], version: '2026-01-01T00:00:00.000Z', calendarExceptions: [{ date, closed: true }, { date: next, closed: false, opensAt: '11:00', closesAt: '14:00' }, { date: saturday, closed: false, opensAt: '10:00', closesAt: '12:00' }] } } } })
    if (path !== 'callback') throw Error('Provider requests forbidden')
    return route.fulfill({ json: { data: { received: true } } })
  })
  await page.goto(shop); await page.getByRole('button', { name: 'Chat with us', exact: true }).click()
  const frame = page.frameLocator('iframe[title="Business website assistant"]')
  await frame.getByLabel('Full name', { exact: true }).fill('Sample Visitor'); await frame.getByLabel('Phone number', { exact: true }).fill('+12025550123'); await frame.getByLabel('What should the business know?', { exact: true }).fill('Discuss services')
  const time = frame.getByLabel('Preferred callback time (optional)', { exact: true }), review = frame.getByRole('button', { name: 'Review callback request', exact: true })
  await time.fill(`${date}T10:00`); await review.click(); await expect(frame.locator('#callback-review')).toBeHidden(); await expect(frame.locator('#callback-status')).toContainText('business hours')
  await time.fill(`${next}T10:00`); await review.click(); await expect(frame.locator('#callback-review')).toBeHidden()
  await time.fill(`${next}T11:00`); await review.click(); await expect(frame.locator('#review-time')).toContainText(`${next} 11:00 (Asia/Manila)`)
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await time.fill(`${saturday}T10:00`); await expect(frame.locator('#callback-review')).toBeHidden(); await review.click(); await expect(frame.getByRole('checkbox')).not.toBeChecked()
  await frame.getByRole('checkbox', { name: /I agree Sample Business may contact me/ }).check(); await frame.getByRole('button', { name: 'Confirm callback request', exact: true }).click(); await expect(frame.locator('#callback-status')).toContainText('sent to the business for review')
  expect(calls.map(call => call.path)).toEqual(['session', 'callback']); expect(calls[1].body.preferredTime).toMatchObject({ localTime: `${saturday}T10:00`, timeZone: 'Asia/Manila' })
})
